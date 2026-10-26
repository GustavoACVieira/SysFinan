import type {
  Analise,
  Classificacao,
  ClassificacaoEntrada,
  Consulta,
  Conta,
  ContaEntrada,
  Lancamento,
  NotaFiscalExtraida,
  Pessoa,
  PessoaEntrada,
  ResultadoExtracao,
  StatusChaveApi,
} from './types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const CHAVE_TOKEN = 'sysfinan:token'
// Compartilhadas entre as abas: mexer em uma mantém todas conectadas.
const CHAVE_INATIVIDADE = 'sysfinan:inatividade'
const CHAVE_ATIVIDADE = 'sysfinan:ultima-atividade'
const INATIVIDADE_PADRAO = 30 * 60 // segundos; o back-end informa o valor no login

/** Lançado quando o back-end recusa o token: o front deve voltar ao login. */
export class SessaoExpirada extends Error {}

export function obterToken(): string | null {
  return localStorage.getItem(CHAVE_TOKEN)
}

/** Intervalo mínimo entre as renovações da sessão no back-end, enquanto há uso. */
export const RENOVAR_A_CADA = 60_000 // ms

/**
 * Tempo sem uso (em ms) que encerra a sessão. Fica uma margem abaixo do back-end, que conta
 * desde a última requisição (renovada no máximo a cada RENOVAR_A_CADA): assim o front sempre
 * encerra primeiro e o aviso de último minuto nunca mente.
 */
export function tempoInatividade(): number {
  const total = (Number(localStorage.getItem(CHAVE_INATIVIDADE)) || INATIVIDADE_PADRAO) * 1000
  return total - Math.min(RENOVAR_A_CADA, total / 4)
}

export function ultimaAtividade(): number {
  return Number(localStorage.getItem(CHAVE_ATIVIDADE)) || 0
}

export function registrarAtividade(): void {
  localStorage.setItem(CHAVE_ATIVIDADE, String(Date.now()))
}

/** Há token, mas ninguém mexeu na tela dentro do prazo (ex.: navegador fechado por horas). */
export function sessaoOciosa(): boolean {
  return obterToken() !== null && Date.now() - ultimaAtividade() > tempoInatividade()
}

async function mensagemDeErro(resposta: Response, padrao: string): Promise<string> {
  const corpo = await resposta.json().catch(() => null)
  return typeof corpo?.detail === 'string' ? corpo.detail : `${padrao} (HTTP ${resposta.status})`
}

async function requisitar(caminho: string, init: RequestInit, falha: string): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = obterToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const resposta = await fetch(`${API_URL}${caminho}`, { ...init, headers })

  if (resposta.status === 401) {
    localStorage.removeItem(CHAVE_TOKEN)
    throw new SessaoExpirada(await mensagemDeErro(resposta, 'Sessão expirada'))
  }
  if (!resposta.ok) throw new Error(await mensagemDeErro(resposta, falha))
  return resposta
}

export interface VersaoApi {
  commit: string
  alterado: boolean
}

/** Rota pública: funciona antes do login. */
export async function obterVersaoApi(): Promise<VersaoApi> {
  const resposta = await fetch(`${API_URL}/versao`)
  if (!resposta.ok) throw new Error(`Falha ao consultar a versão (HTTP ${resposta.status})`)
  return (await resposta.json()) as VersaoApi
}

export async function entrar(usuario: string, senha: string): Promise<void> {
  const resposta = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha }),
  })
  if (!resposta.ok) throw new Error(await mensagemDeErro(resposta, 'Falha no login'))

  const { token, inatividadeSegundos } = (await resposta.json()) as {
    token: string
    inatividadeSegundos: number
  }
  localStorage.setItem(CHAVE_TOKEN, token)
  localStorage.setItem(CHAVE_INATIVIDADE, String(inatividadeSegundos))
  registrarAtividade()
}

/** Avisa o back-end que o usuário está em uso, para a sessão não expirar por inatividade. */
export async function renovarSessao(): Promise<void> {
  await requisitar('/sessao/renovar', { method: 'POST' }, 'Falha ao renovar a sessão')
}

export async function sair(): Promise<void> {
  try {
    await requisitar('/logout', { method: 'POST' }, 'Falha ao sair')
  } catch {
    // Sai mesmo com o back-end fora do ar.
  } finally {
    localStorage.removeItem(CHAVE_TOKEN)
  }
}

export async function obterStatusChave(): Promise<StatusChaveApi> {
  const resposta = await requisitar('/chave-api', { method: 'GET' }, 'Falha ao consultar a chave')
  return (await resposta.json()) as StatusChaveApi
}

export async function salvarChave(chave: string): Promise<StatusChaveApi> {
  const resposta = await requisitar(
    '/chave-api',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave }),
    },
    'Falha ao salvar a chave',
  )
  return (await resposta.json()) as StatusChaveApi
}

export async function removerChave(): Promise<StatusChaveApi> {
  const resposta = await requisitar('/chave-api', { method: 'DELETE' }, 'Falha ao remover a chave')
  return (await resposta.json()) as StatusChaveApi
}

/** Envia o PDF da nota fiscal para o Agent e devolve os dados extraídos. */
export async function extrairDados(arquivo: File): Promise<ResultadoExtracao> {
  const formData = new FormData()
  formData.append('arquivo', arquivo)

  const resposta = await requisitar('/extrair', { method: 'POST', body: formData }, 'Falha na extração')
  return (await resposta.json()) as ResultadoExtracao
}

// ---------------------------------------------------------------------------
// Cadastros e contas
// ---------------------------------------------------------------------------

async function pedirJson<T>(caminho: string, init: RequestInit, falha: string): Promise<T> {
  const resposta = await requisitar(caminho, init, falha)
  return (await resposta.json()) as T
}

function comCorpo(method: string, corpo: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
}

function parametros(consulta: Consulta): string {
  const busca = new URLSearchParams()
  for (const [chave, valor] of Object.entries(consulta)) {
    if (valor) busca.set(chave, valor)
  }
  const texto = busca.toString()
  return texto ? `?${texto}` : ''
}

/** Rotas comuns aos cadastros (backend/crud.py). Não há exclusão: o DELETE inativa. */
export interface Cadastro<T, E> {
  listar: (consulta: Consulta) => Promise<T[]>
  criar: (dados: E) => Promise<T>
  editar: (id: number, dados: E) => Promise<T>
  inativar: (id: number) => Promise<T>
  reativar: (id: number) => Promise<T>
}

function cadastro<T, E>(rota: string): Cadastro<T, E> {
  return {
    listar: (consulta) =>
      pedirJson(`${rota}${parametros(consulta)}`, { method: 'GET' }, 'Falha ao carregar os registros'),
    criar: (dados) => pedirJson(rota, comCorpo('POST', dados), 'Falha ao salvar'),
    editar: (id, dados) => pedirJson(`${rota}/${id}`, comCorpo('PUT', dados), 'Falha ao salvar'),
    inativar: (id) => pedirJson(`${rota}/${id}`, { method: 'DELETE' }, 'Falha ao excluir'),
    reativar: (id) => pedirJson(`${rota}/${id}/reativar`, { method: 'PUT' }, 'Falha ao reativar'),
  }
}

export const pessoas = cadastro<Pessoa, PessoaEntrada>('/pessoas')
export const classificacoes = cadastro<Classificacao, ClassificacaoEntrada>('/classificacoes')
export const contas = cadastro<Conta, ContaEntrada>('/contas')

/** 2ª etapa: informa se o fornecedor, o faturado e cada despesa da nota existem no banco. */
export async function analisarNota(nota: NotaFiscalExtraida): Promise<Analise> {
  return pedirJson('/contas/analisar', comCorpo('POST', nota), 'Falha ao consultar o banco')
}

/** 2ª etapa: cria o que falta e lança a conta a pagar, numa transação só. */
export async function lancarNota(nota: NotaFiscalExtraida): Promise<Lancamento> {
  return pedirJson('/contas/lancar', comCorpo('POST', nota), 'Falha ao lançar o registro')
}
