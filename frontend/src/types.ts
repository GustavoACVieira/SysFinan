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

export interface StatusChaveApi {
  informada: boolean
  /** Só o final da chave, ex.: "••••abcd". */
  mascara: string | null
  /** Quando o Google aceitou a chave. */
  verificadaEm: string | null
}

export type StatusEtapa = 'concluida' | 'falhou' | 'nao_executada'

export interface VerificacaoEtapa {
  etapa: string
  titulo: string
  status: StatusEtapa
  tentativas: number
  modelo: string | null
  duracaoMs: number
  problemas: string[]
  avisos: string[]
}

export interface Categoria {
  nome: string
  descricao: string
  /** true para as 9 categorias fixas do sistema. */
  padrao: boolean
  ativa: boolean
  criadaEm: string | null
  notaOrigem: string | null
}

/** `dados` só vem quando todas as etapas concluíram. */
export interface ResultadoExtracao {
  concluida: boolean
  etapas: VerificacaoEtapa[]
  dados: NotaFiscalExtraida | null
  categoriaCriada: Categoria | null
}
