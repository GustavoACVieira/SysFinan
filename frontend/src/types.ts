export interface Fornecedor {
  razaoSocial: string | null
  fantasia: string | null
  cnpj: string | null
}

export interface Faturado {
  nomeCompleto: string | null
  cpf: string | null
}

export interface Parcela {
  numero: number
  dataVencimento: string | null
  valor: number | null
}

/** Contrato do JSON devolvido pelo Agent a partir do PDF da nota fiscal. */
export interface NotaFiscalExtraida {
  fornecedor: Fornecedor
  faturado: Faturado
  numeroNotaFiscal: string | null
  dataEmissao: string | null
  descricaoProdutos: string[]
  quantidadeParcelas: number
  parcelas: Parcela[]
  valorTotal: number | null
  tiposDespesa: string[]
}
