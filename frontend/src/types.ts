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

// ---------------------------------------------------------------------------
// Cadastros e contas (back-end: pessoas.py, classificacoes.py, contas.py)
// ---------------------------------------------------------------------------

export type Status = 'ATIVO' | 'INATIVO'
export type TipoPessoa = 'CLIENTE' | 'FORNECEDOR' | 'FATURADO'
export type TipoClassificacao = 'RECEITA' | 'DESPESA'
export type TipoMovimento = 'APAGAR' | 'ARECEBER'
export type Direcao = 'asc' | 'desc'

/** Filtros do GET de listagem. Sem `status`, o back-end traz só os ATIVOS. */
export interface Consulta {
  busca?: string
  tipo?: string
  status?: Status
  ordem?: string
  direcao?: Direcao
}

/** Sem status: o CREATE grava ATIVO e o UPDATE não o altera. */
export interface PessoaEntrada {
  tipo: TipoPessoa
  razaoSocial: string
  fantasia: string | null
  /** CPF ou CNPJ; o back-end devolve com máscara. */
  documento: string
}

export interface Pessoa extends PessoaEntrada {
  idPessoas: number
  status: Status
}

export interface ClassificacaoEntrada {
  tipo: TipoClassificacao
  descricao: string
}

export interface Classificacao extends ClassificacaoEntrada {
  idClassificacao: number
  status: Status
}

export interface ParcelaEntrada {
  dataVencimento: string
  valorParcela: number
}

export interface ContaEntrada {
  tipo: TipoMovimento
  numeroNotaFiscal: string | null
  dataEmissao: string
  descricao: string | null
  valorTotal: number
  /** FORNECEDOR na conta a pagar; CLIENTE na a receber. */
  idFornecedorCliente: number
  idFaturado: number
  /** DESPESAS na conta a pagar; RECEITAS na a receber. */
  idClassificacoes: number[]
  parcelas: ParcelaEntrada[]
}

export interface ParcelaConta {
  idParcelaContas: number
  /** ÚNICA, 1/3, 2/3... (gerada pelo back-end, em ordem de vencimento). */
  identificacao: string
  dataVencimento: string
  valorParcela: number
}

export interface Conta {
  idMovimentoContas: number
  tipo: TipoMovimento
  numeroNotaFiscal: string | null
  dataEmissao: string
  descricao: string | null
  valorTotal: number
  status: Status
  fornecedorCliente: Pessoa
  faturado: Pessoa
  classificacoes: Classificacao[]
  parcelas: ParcelaConta[]
}

// ---------------------------------------------------------------------------
// 2ª etapa: análise e lançamento da nota (back-end: lancamento.py)
// ---------------------------------------------------------------------------

export interface ConsultaPessoa {
  razaoSocial: string | null
  documento: string | null
  existe: boolean
  id: number | null
  status: Status | null
}

export interface ConsultaDespesa {
  descricao: string
  existe: boolean
  id: number | null
  status: Status | null
}

export interface Analise {
  fornecedor: ConsultaPessoa
  faturado: ConsultaPessoa
  despesas: ConsultaDespesa[]
  /** ID da conta, se esta nota deste fornecedor já foi lançada. */
  contaJaLancada: number | null
}

export interface Lancamento {
  mensagem: string
  conta: Conta
}
