"""Agent1 — responsavel por ler o PDF da nota fiscal e devolver os dados estruturados."""

import os
from pathlib import Path

from google import genai
from google.genai import types

from models import NotaFiscalExtraida

MODELO_PADRAO = "gemini-2.5-flash"

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
- FORNECEDOR é o emitente da nota. FATURADO é o destinatário/remetente.
- Datas sempre no formato YYYY-MM-DD.
- Valores como número decimal, usando ponto como separador (ex.: 3086.75).
- As parcelas vêm do bloco FATURA/DUPLICATAS. Se a nota tiver um único vencimento,
  devolva uma parcela com numero = 1.
- quantidadeParcelas deve ser igual ao tamanho da lista de parcelas.
- descricaoProdutos deve conter a descrição de cada item do bloco DADOS DOS PRODUTOS/SERVIÇOS.
- Não invente dados: use apenas o que consta no documento.

Regra de classificação:
- tiposDespesa NÃO é um campo extraído do documento. Ele deve ser interpretado a partir
  das descrições dos produtos, escolhendo entre as categorias abaixo:

{categorias}

Exemplos:
- Compra de óleo diesel -> MANUTENÇÃO E OPERAÇÃO
- Compra de material hidráulico -> INFRAESTRUTURA E UTILIDADES
"""


class Agent1:
    """Agent responsável pela extração dos dados da nota fiscal via Gemini."""

    def __init__(self, api_key: str | None = None, modelo: str | None = None):
        self._api_key = api_key or os.getenv("GEMINI_API_KEY")
        self._modelo = modelo or os.getenv("GEMINI_MODEL", MODELO_PADRAO)
        self._client: genai.Client | None = None

    def _obter_client(self) -> genai.Client:
        """Cria o client sob demanda, para a API subir mesmo sem a chave configurada."""
        if self._client is None:
            if not self._api_key:
                raise RuntimeError(
                    "GEMINI_API_KEY não configurada. Informe a chave em backend/.env."
                )
            self._client = genai.Client(api_key=self._api_key)
        return self._client

    def _instrucao(self) -> str:
        categorias = "\n".join(f"- {nome}: {exemplos}" for nome, exemplos in CATEGORIAS.items())
        return INSTRUCAO.format(categorias=categorias)

    def extrair_dados(self, caminho_arquivo: str | Path) -> NotaFiscalExtraida:
        """Lê o PDF da nota fiscal e devolve os dados já estruturados."""
        pdf = Path(caminho_arquivo).read_bytes()

        resposta = self._obter_client().models.generate_content(
            model=self._modelo,
            contents=[
                types.Part.from_bytes(data=pdf, mime_type="application/pdf"),
                "Extraia os dados desta nota fiscal e classifique a despesa.",
            ],
            config=types.GenerateContentConfig(
                system_instruction=self._instrucao(),
                response_mime_type="application/json",
                response_schema=NotaFiscalExtraida,
                temperature=0,
            ),
        )

        dados = resposta.parsed
        if not isinstance(dados, NotaFiscalExtraida):
            raise ValueError("O Gemini não devolveu um JSON no formato esperado.")

        return dados
