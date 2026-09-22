import type { NotaFiscalExtraida } from './types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/** Envia o PDF da nota fiscal para o Agent e devolve os dados extraidos. */
export async function extrairDados(arquivo: File): Promise<NotaFiscalExtraida> {
  const formData = new FormData()
  formData.append('arquivo', arquivo)

  const resposta = await fetch(`${API_URL}/extrair`, {
    method: 'POST',
    body: formData,
  })

  if (!resposta.ok) {
    throw new Error(`Falha na extração (HTTP ${resposta.status})`)
  }

  return (await resposta.json()) as NotaFiscalExtraida
}
