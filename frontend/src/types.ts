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

/** Situação da chave da API do Gemini cadastrada no back-end. */
export interface StatusChaveApi {
  informada: boolean
  /** Apenas o final da chave (ex.: "••••abcd"), nunca a chave inteira. */
  mascara: string | null
}

export type StatusEtapa = 'concluida' | 'falhou' | 'nao_executada'

/** Relatório da verificação de uma etapa do Agent1. */
export interface VerificacaoEtapa {
  etapa: string
  titulo: string
  status: StatusEtapa
  tentativas: number
  modelo: string | null
  duracaoMs: number
  /** Falhas que impediram a etapa de concluir. */
  problemas: string[]
  /** Pontos de atenção que não impediram a etapa. */
  avisos: string[]
}

/** Categoria de despesa: uma das 9 padrão ou criada pelo agent. */
export interface Categoria {
  nome: string
  descricao: string
  /** true para as 9 categorias fixas do sistema (não podem ser inativadas). */
  padrao: boolean
  ativa: boolean
  criadaEm: string | null
  /** Número da nota que levou o agent a criar a categoria. */
  notaOrigem: string | null
}

/** Resposta do POST /extrair: `dados` só vem quando todas as etapas concluíram. */
export interface ResultadoExtracao {
  concluida: boolean
  etapas: VerificacaoEtapa[]
  dados: NotaFiscalExtraida | null
  /** Categoria que o agent criou nesta extração, se criou. */
  categoriaCriada: Categoria | null
}

export interface StatusModelo {
  modelo: string
  disponivel: boolean
  latenciaMs: number | null
  erro: string | null
}

export interface TesteGeracao {
  sucesso: boolean
  modelo: string | null
  latenciaMs: number | null
  erro: string | null
  cotaEsgotada: boolean
}

/** Diagnóstico de funcionamento do Agent1 (GET /saude/agent). */
export interface SaudeAgent {
  status: 'operacional' | 'degradado' | 'inoperante'
  mensagem: string
  chaveInformada: boolean
  chaveValida: boolean | null
  modelos: StatusModelo[]
  testeGeracao: TesteGeracao | null
  etapas: string[]
  verificadoEm: string
}
