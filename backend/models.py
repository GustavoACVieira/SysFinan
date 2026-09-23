"""Contrato de dados da extracao da nota fiscal.

Os campos usam camelCase de proposito: estes modelos sao, ao mesmo tempo, o
response_schema enviado ao Gemini e o JSON devolvido ao front, que declara o
mesmo contrato em frontend/src/types.ts.

Os campos extraidos do documento aceitam null: se a informacao nao constar na
nota, o Gemini deve devolver null em vez de inventar um valor.
"""

from enum import Enum

from pydantic import BaseModel, Field


class CategoriaDespesa(str, Enum):
    """Categorias possiveis de classificacao da despesa."""

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


class NotaFiscalExtraida(BaseModel):
    """Dados extraidos de uma nota fiscal de CONTAS A PAGAR."""

    fornecedor: Fornecedor
    faturado: Faturado
    numeroNotaFiscal: str | None = Field(description="Numero da nota fiscal")
    dataEmissao: str | None = Field(description="Data de emissao da nota (YYYY-MM-DD)")
    descricaoProdutos: list[str] = Field(
        description="Descricao de cada produto/servico constante na nota"
    )
    quantidadeParcelas: int = Field(description="Quantidade total de parcelas da nota")
    parcelas: list[Parcela] = Field(
        description="Parcelas da nota, uma para cada vencimento distinto"
    )
    valorTotal: float | None = Field(description="Valor total da nota fiscal")
    tiposDespesa: list[CategoriaDespesa] = Field(
        description=(
            "Classificacao da despesa interpretada a partir dos produtos da nota. "
            "Nao e um campo extraido do documento. Deve conter ao menos uma categoria."
        )
    )
