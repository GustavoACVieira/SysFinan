"""Contrato de dados da extracao da nota fiscal.

Os campos usam camelCase de proposito: estes modelos sao, ao mesmo tempo, o
response_schema enviado ao Gemini e o JSON devolvido ao front, que declara o
mesmo contrato em frontend/src/types.ts.

Os campos extraidos do documento aceitam null: se a informacao nao constar na
nota, o Gemini deve devolver null em vez de inventar um valor.

Organizacao:
- Esquemas das etapas: cada um e o response_schema de uma etapa do Agent1, que
  so avanca para o proximo quando o atual passa na verificacao.
- NotaFiscalExtraida: a nota completa, composta pelos esquemas das etapas.
- Verificacao: o relatorio de cada etapa e o diagnostico de funcionamento do agent.
"""

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class CategoriaDespesa(str, Enum):
    """As 9 categorias padrao. O agent pode criar outras (ver categorias.py)."""

    INSUMOS_AGRICOLAS = "INSUMOS AGRÍCOLAS"
    MANUTENCAO_E_OPERACAO = "MANUTENÇÃO E OPERAÇÃO"
    RECURSOS_HUMANOS = "RECURSOS HUMANOS"
    SERVICOS_OPERACIONAIS = "SERVIÇOS OPERACIONAIS"
    INFRAESTRUTURA_E_UTILIDADES = "INFRAESTRUTURA E UTILIDADES"
    ADMINISTRATIVAS = "ADMINISTRATIVAS"
    SEGUROS_E_PROTECAO = "SEGUROS E PROTEÇÃO"
    IMPOSTOS_E_TAXAS = "IMPOSTOS E TAXAS"
    INVESTIMENTOS = "INVESTIMENTOS"


class Fornecedor(BaseModel):
    razaoSocial: str | None = Field(description="Razao social do emitente da nota fiscal")
    fantasia: str | None = Field(
        default=None, description="Nome fantasia do emitente, se constar na nota"
    )
    cnpj: str | None = Field(description="CNPJ do emitente, no formato 00.000.000/0000-00")


class Faturado(BaseModel):
    nomeCompleto: str | None = Field(
        description="Nome completo / razao social do destinatario da nota fiscal"
    )
    cpf: str | None = Field(
        description="CPF do destinatario, no formato 000.000.000-00 (null se nao houver CPF)"
    )


class Parcela(BaseModel):
    numero: int = Field(description="Numero sequencial da parcela, iniciando em 1")
    dataVencimento: str | None = Field(
        description="Data de vencimento da parcela (YYYY-MM-DD)"
    )
    valor: float | None = Field(description="Valor da parcela")


# ---------------------------------------------------------------------------
# Esquemas das etapas
# ---------------------------------------------------------------------------


class EsquemaIdentificacao(BaseModel):
    """Etapa 1 — quem emitiu a nota, para quem e qual e a nota."""

    fornecedor: Fornecedor
    faturado: Faturado
    numeroNotaFiscal: str | None = Field(description="Numero da nota fiscal")
    dataEmissao: str | None = Field(description="Data de emissao da nota (YYYY-MM-DD)")


class EsquemaProdutos(BaseModel):
    """Etapa 2 — o que foi comprado."""

    descricaoProdutos: list[str] = Field(
        description="Descricao de cada produto/servico constante na nota"
    )


class EsquemaFinanceiro(BaseModel):
    """Etapa 3 — quanto e quando pagar."""

    quantidadeParcelas: int = Field(description="Quantidade total de parcelas da nota")
    parcelas: list[Parcela] = Field(
        description="Parcelas da nota, uma para cada vencimento distinto"
    )
    valorTotal: float | None = Field(description="Valor total da nota fiscal")


class EsquemaClassificacao(BaseModel):
    """Etapa 4 — em que tipo de despesa a nota se enquadra (interpretado, nao extraido).

    No JSON final e uma lista de nomes. Para o Gemini, a etapa monta na hora um esquema
    com as categorias ativas como enumeracao (ver etapas.esquema_classificacao), entao
    ele nao consegue devolver um nome fora da lista.
    """

    tiposDespesa: list[str] = Field(
        description=(
            "Classificacao da despesa interpretada a partir dos produtos da nota. "
            "Nao e um campo extraido do documento. Deve conter ao menos uma categoria."
        )
    )


class NovaCategoria(BaseModel):
    """Categoria proposta pelo agent quando nenhuma das existentes representa a despesa."""

    nome: str = Field(
        description="Nome curto em MAIUSCULAS, no estilo das existentes (ex.: SERVICOS OPERACIONAIS)"
    )
    descricao: str = Field(
        description="O que entra nesta categoria, com exemplos de itens, em uma frase"
    )


# A ordem das bases e a inversa da ordem dos campos: o Pydantic monta os campos
# percorrendo as bases de tras para frente, e o JSON precisa sair na ordem das etapas.
class NotaFiscalExtraida(
    EsquemaClassificacao, EsquemaFinanceiro, EsquemaProdutos, EsquemaIdentificacao
):
    """Dados extraidos de uma nota fiscal de CONTAS A PAGAR (todas as etapas juntas)."""


# ---------------------------------------------------------------------------
# Verificacao
# ---------------------------------------------------------------------------


class StatusEtapa(str, Enum):
    CONCLUIDA = "concluida"
    FALHOU = "falhou"
    NAO_EXECUTADA = "nao_executada"  # uma etapa anterior falhou


class VerificacaoEtapa(BaseModel):
    """Relatorio da verificacao de uma etapa: e ele que libera (ou nao) a proxima."""

    etapa: str
    titulo: str
    status: StatusEtapa
    tentativas: int = 0
    modelo: str | None = Field(default=None, description="Modelo que atendeu a etapa")
    duracaoMs: int = 0
    problemas: list[str] = Field(
        default_factory=list, description="Falhas que impedem concluir a etapa"
    )
    avisos: list[str] = Field(
        default_factory=list, description="Pontos de atencao que nao impedem concluir"
    )


class Categoria(BaseModel):
    """Categoria de despesa como o sistema a guarda (padrao ou criada pelo agent)."""

    nome: str
    descricao: str
    padrao: bool = Field(description="true para as 9 categorias fixas do sistema")
    ativa: bool = True
    criadaEm: str | None = None
    notaOrigem: str | None = Field(
        default=None, description="Numero da nota que levou o agent a criar a categoria"
    )


class SituacaoCategoria(BaseModel):
    """Entrada do PUT /categorias/situacao: inativar ou reativar uma categoria criada."""

    nome: str
    ativa: bool


class ResultadoExtracao(BaseModel):
    """Resposta do POST /extrair: a nota (se todas as etapas concluiram) e o relatorio."""

    concluida: bool
    etapas: list[VerificacaoEtapa]
    dados: NotaFiscalExtraida | None = None
    categoriaCriada: Categoria | None = Field(
        default=None, description="Categoria que o agent criou nesta extracao, se criou"
    )


class StatusModelo(BaseModel):
    modelo: str
    disponivel: bool
    latenciaMs: int | None = None
    erro: str | None = None


class TesteGeracao(BaseModel):
    """Chamada real ao Gemini com saida estruturada, igual a usada nas etapas."""

    sucesso: bool
    modelo: str | None = None
    latenciaMs: int | None = None
    erro: str | None = None
    cotaEsgotada: bool = False


class SaudeAgent(BaseModel):
    """Diagnostico de funcionamento do Agent1."""

    status: Literal["operacional", "degradado", "inoperante"]
    mensagem: str
    chaveInformada: bool
    chaveValida: bool | None = Field(
        default=None, description="null quando nao foi possivel testar (sem chave)"
    )
    modelos: list[StatusModelo] = Field(default_factory=list)
    testeGeracao: TesteGeracao | None = None
    etapas: list[str] = Field(description="Etapas do pipeline, na ordem de execucao")
    verificadoEm: str
