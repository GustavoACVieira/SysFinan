"""Contrato de dados da extracao da nota fiscal.

Os campos usam camelCase porque estes modelos sao o response_schema enviado ao
Gemini e tambem o JSON devolvido ao front (ver frontend/src/types.ts).
"""

from enum import Enum

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

    Para o Gemini a etapa usa etapas.esquema_classificacao, com as categorias ativas.
    """

    tiposDespesa: list[str] = Field(
        description=(
            "Classificacao da despesa interpretada a partir dos produtos da nota. "
            "Nao e um campo extraido do documento. Deve conter ao menos uma categoria."
        )
    )


class NovaCategoria(BaseModel):
    nome: str = Field(
        description="Nome curto em MAIUSCULAS, no estilo das existentes (ex.: SERVICOS OPERACIONAIS)"
    )
    descricao: str = Field(
        description="O que entra nesta categoria, com exemplos de itens, em uma frase"
    )


# Bases em ordem inversa para os campos sairem na ordem das etapas.
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
    NAO_EXECUTADA = "nao_executada"


class VerificacaoEtapa(BaseModel):
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
    nome: str
    descricao: str
    padrao: bool = Field(description="true para as 9 categorias fixas do sistema")
    ativa: bool = True
    criadaEm: str | None = None
    notaOrigem: str | None = Field(
        default=None, description="Numero da nota que levou o agent a criar a categoria"
    )


class SituacaoCategoria(BaseModel):
    nome: str
    ativa: bool


class ResultadoExtracao(BaseModel):
    concluida: bool
    etapas: list[VerificacaoEtapa]
    dados: NotaFiscalExtraida | None = None
    categoriaCriada: Categoria | None = Field(
        default=None, description="Categoria que o agent criou nesta extracao, se criou"
    )

