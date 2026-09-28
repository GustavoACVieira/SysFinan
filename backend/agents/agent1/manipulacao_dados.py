"""Agent1 — responsavel por ler o PDF da nota fiscal e devolver os dados estruturados."""

import logging
import os
from pathlib import Path

from google import genai
from google.genai import types
from google.genai import errors as genai_errors

from models import NotaFiscalExtraida

logger = logging.getLogger(__name__)

# Cadeia do melhor Flash para o mais disponivel. Os modelos mais novos vivem
# sobrecarregados (HTTP 503), entao caimos para o seguinte em vez de falhar.
MODELOS_PADRAO = (
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
)
# Poucas tentativas por modelo: quem da resiliencia aqui e a cadeia de fallback,
# e repetir muito no mesmo modelo sobrecarregado so aumenta a espera do usuario.
TENTATIVAS = 2

# Subcategorias usadas apenas como contexto de classificacao no prompt.
CATEGORIAS = {
    "INSUMOS AGRÍCOLAS": "sementes, fertilizantes, defensivos agrícolas, corretivos",
    "MANUTENÇÃO E OPERAÇÃO": (
        "combustíveis e lubrificantes; peças, parafusos e componentes mecânicos; "
        "manutenção de máquinas e equipamentos; pneus, filtros, correias; "
        "ferramentas e utensílios"
    ),
    "RECURSOS HUMANOS": "mão de obra temporária; salários e encargos",
    "SERVIÇOS OPERACIONAIS": (
        "frete e transporte; colheita terceirizada; secagem e armazenagem; "
        "pulverização e aplicação"
    ),
    "INFRAESTRUTURA E UTILIDADES": (
        "energia elétrica; arrendamento de terras; construções e reformas; "
        "materiais de construção"
    ),
    "ADMINISTRATIVAS": (
        "honorários contábeis, advocatícios e agronômicos; despesas bancárias e financeiras"
    ),
    "SEGUROS E PROTEÇÃO": "seguro agrícola; seguro de ativos (máquinas/veículos); seguro prestamista",
    "IMPOSTOS E TAXAS": "ITR, IPTU, IPVA, INCRA-CCIR",
    "INVESTIMENTOS": (
        "aquisição de máquinas e implementos; de veículos; de imóveis; infraestrutura rural"
    ),
}

INSTRUCAO = """Você é um agente especialista em notas fiscais eletrônicas brasileiras (DANFE).
Extraia os dados da nota fiscal em anexo, que representa um registro de CONTAS A PAGAR.

Regras de extração:
- FORNECEDOR é o EMITENTE da nota (bloco "IDENTIFICAÇÃO DO EMITENTE"): razão social,
  nome fantasia (se houver) e CNPJ.
- FATURADO é o DESTINATÁRIO da nota (bloco "DESTINATÁRIO/REMETENTE"): nome e CPF.
- CNPJ no formato 00.000.000/0000-00 e CPF no formato 000.000.000-00.
- Datas sempre no formato YYYY-MM-DD.
- Valores como número decimal, usando ponto como separador (ex.: 3086.75).
- valorTotal é o "VALOR TOTAL DA NOTA".
- As parcelas vêm do bloco FATURA/DUPLICATAS, na ordem dos vencimentos, numeradas a
  partir de 1. Se a nota não tiver esse bloco, devolva uma única parcela com
  valor = valorTotal e a data de vencimento que constar na nota (ou null).
- quantidadeParcelas deve ser igual ao tamanho da lista de parcelas.
- descricaoProdutos deve conter a descrição de cada item do bloco DADOS DOS PRODUTOS/SERVIÇOS,
  exatamente como está escrita.
- Não invente dados: use apenas o que consta no documento. Se uma informação não constar,
  devolva null no campo correspondente.

Regra de classificação:
- tiposDespesa NÃO é um campo extraído do documento. Ele deve ser interpretado a partir
  das descrições dos produtos, escolhendo entre as categorias abaixo:

{categorias}

- Considere a finalidade da compra em uma propriedade rural, não apenas o nome do item.
- Devolva a categoria que melhor representa a nota como um todo (normalmente uma só).
  Inclua mais de uma apenas quando a nota misturar itens de categorias claramente distintas.

Exemplos:
- Compra de óleo diesel -> MANUTENÇÃO E OPERAÇÃO
- Graxa, rolamentos, buchas e peças de reposição -> MANUTENÇÃO E OPERAÇÃO
- Compra de material hidráulico -> INFRAESTRUTURA E UTILIDADES
- Cimento, tijolos, telhas -> INFRAESTRUTURA E UTILIDADES
- Sementes de soja, adubo, herbicida, calcário -> INSUMOS AGRÍCOLAS
- Trator, plantadeira ou caminhão novos -> INVESTIMENTOS
- Frete de grãos -> SERVIÇOS OPERACIONAIS
"""


class Agent1:
    """Agent responsável pela extração dos dados da nota fiscal via Gemini."""

    def __init__(self, api_key: str | None = None, modelo: str | None = None):
        self._api_key = api_key or os.getenv("GEMINI_API_KEY")
        self._modelos = self._montar_cadeia(modelo or os.getenv("GEMINI_MODEL"))
        self._client: genai.Client | None = None

    @staticmethod
    def _montar_cadeia(preferido: str | None) -> tuple[str, ...]:
        """Modelo preferido na frente, seguido dos demais como reserva."""
        if not preferido:
            return MODELOS_PADRAO
        # Aceita uma lista explicita separada por virgula em GEMINI_MODEL.
        escolhidos = [m.strip() for m in preferido.split(",") if m.strip()]
        reservas = [m for m in MODELOS_PADRAO if m not in escolhidos]
        return tuple(escolhidos + reservas)

    @property
    def api_key_informada(self) -> bool:
        return bool(self._api_key)

    @property
    def api_key(self) -> str | None:
        return self._api_key

    def definir_api_key(self, api_key: str | None) -> None:
        """Troca a chave em tempo de execucao; o client e recriado na proxima chamada."""
        self._api_key = api_key or None
        self._client = None

    def _obter_client(self) -> genai.Client:
        """Cria o client sob demanda, para a API subir mesmo sem a chave configurada."""
        if self._client is None:
            if not self._api_key:
                raise RuntimeError(
                    "Chave da API do Gemini não informada. Cadastre-a na tela de configuração."
                )
            self._client = genai.Client(
                api_key=self._api_key,
                # Repete a chamada em erros transitórios do Gemini (429, 5xx).
                http_options=types.HttpOptions(
                    retry_options=types.HttpRetryOptions(attempts=TENTATIVAS)
                ),
            )
        return self._client

    def _instrucao(self) -> str:
        categorias = "\n".join(f"- {nome}: {exemplos}" for nome, exemplos in CATEGORIAS.items())
        return INSTRUCAO.format(categorias=categorias)

    def extrair_dados(self, caminho_arquivo: str | Path) -> NotaFiscalExtraida:
        """Lê o PDF da nota fiscal e devolve os dados já estruturados."""
        pdf = Path(caminho_arquivo).read_bytes()

        conteudo = [
            types.Part.from_bytes(data=pdf, mime_type="application/pdf"),
            "Extraia os dados desta nota fiscal e classifique a despesa.",
        ]
        config = types.GenerateContentConfig(
            system_instruction=self._instrucao(),
            response_mime_type="application/json",
            response_schema=NotaFiscalExtraida,
            # Gemini 3 e otimizado para os valores padrao de amostragem: forcar
            # temperature baixa degrada o raciocinio e pode causar loops.
        )

        resposta = self._gerar_com_fallback(conteudo, config)

        dados = resposta.parsed
        if not isinstance(dados, NotaFiscalExtraida):
            raise ValueError("O Gemini não devolveu um JSON no formato esperado.")

        return self._normalizar(dados)

    def _gerar_com_fallback(self, conteudo: list, config: types.GenerateContentConfig):
        """Percorre a cadeia de modelos ate um responder.

        So troca de modelo em erro de servidor (5xx, tipicamente sobrecarga). Erros
        de chave, cota ou requisicao invalida sobem direto: trocar de modelo nao
        resolveria e so mascararia a causa real.
        """
        client = self._obter_client()
        ultimo_erro: genai_errors.ServerError | None = None

        for modelo in self._modelos:
            try:
                resposta = client.models.generate_content(
                    model=modelo, contents=conteudo, config=config
                )
            except genai_errors.ServerError as erro:
                logger.warning("Modelo %s indisponivel (%s); tentando o proximo.", modelo, erro.code)
                ultimo_erro = erro
                continue

            if modelo != self._modelos[0]:
                logger.info("Extracao feita com o modelo reserva %s.", modelo)
            return resposta

        raise ultimo_erro  # type: ignore[misc]

    @staticmethod
    def _normalizar(dados: NotaFiscalExtraida) -> NotaFiscalExtraida:
        """Garante a consistência entre campos que o modelo pode devolver divergentes."""
        for numero, parcela in enumerate(dados.parcelas, start=1):
            parcela.numero = numero
        if len(dados.parcelas) == 1 and dados.parcelas[0].valor is None:
            dados.parcelas[0].valor = dados.valorTotal
        dados.quantidadeParcelas = len(dados.parcelas)
        dados.tiposDespesa = list(dict.fromkeys(dados.tiposDespesa))
        return dados
