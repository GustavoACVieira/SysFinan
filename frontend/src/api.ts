import type { Categoria, ResultadoExtracao, StatusChaveApi } from './types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const CHAVE_TOKEN = 'sysfinan:token'

/** Lançado quando o back-end recusa o token: o front deve voltar ao login. */
export class SessaoExpirada extends Error {}

export function obterToken(): string | null {
  return localStorage.getItem(CHAVE_TOKEN)
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

  const { token } = (await resposta.json()) as { token: string }
  localStorage.setItem(CHAVE_TOKEN, token)
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

export async function listarCategorias(): Promise<Categoria[]> {
  const resposta = await requisitar('/categorias', { method: 'GET' }, 'Falha ao listar as categorias')
  return (await resposta.json()) as Categoria[]
}

export async function alterarSituacaoCategoria(nome: string, ativa: boolean): Promise<Categoria> {
  const resposta = await requisitar(
    '/categorias/situacao',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, ativa }),
    },
    'Falha ao alterar a categoria',
  )
  return (await resposta.json()) as Categoria
}

/** Envia o PDF da nota fiscal para o Agent e devolve os dados extraídos. */
export async function extrairDados(arquivo: File): Promise<ResultadoExtracao> {
  const formData = new FormData()
  formData.append('arquivo', arquivo)

  const resposta = await requisitar('/extrair', { method: 'POST', body: formData }, 'Falha na extração')
  return (await resposta.json()) as ResultadoExtracao
}
