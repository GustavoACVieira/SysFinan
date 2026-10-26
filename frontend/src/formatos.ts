/** Formatação dos dados para a tela (datas, valores e documentos no padrão brasileiro). */

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatarReais(valor: number | null | undefined): string {
  return valor == null ? '—' : REAIS.format(valor)
}

/** "2025-10-17" -> "17/10/2025", sem passar por Date (que mudaria o dia pelo fuso). */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso
}

/** Valor para o campo de texto: 3086.75 -> "3086,75". */
export function valorParaCampo(valor: number): string {
  return valor.toFixed(2).replace('.', ',')
}

/** Lê "1.234,56", "1234,56" ou "1234.56"; null se não for um valor com até 2 casas. */
export function lerValor(texto: string): number | null {
  let limpo = texto.replace(/\s|R\$/g, '')
  if (!limpo) return null
  if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) limpo = limpo.replace(/\./g, '')
  return /^\d+(\.\d{1,2})?$/.test(limpo) ? Number(limpo) : null
}

/** Máscara aplicada enquanto se digita: CPF até 11 dígitos, CNPJ a partir daí. */
export function mascararDocumento(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

/** "CPF" ou "CNPJ", pela quantidade de dígitos. */
export function tipoDocumento(documento: string | null | undefined): string {
  return (documento ?? '').replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF'
}

function paraIso(data: Date): string {
  const doisDigitos = (n: number) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`
}

/** Data de hoje no fuso do navegador, no formato do campo de data (AAAA-MM-DD). */
export function hojeIso(): string {
  return paraIso(new Date())
}

/** Mesmo dia `meses` depois (31/01 + 1 -> 28/02; + 2 -> 31/03), para sugerir vencimentos. */
export function somarMeses(iso: string, meses: number): string {
  const [ano, mes, dia] = iso.split('-').map(Number)
  if (!ano || !mes || !dia) return ''
  const ultimoDia = new Date(ano, mes - 1 + meses + 1, 0).getDate()
  return paraIso(new Date(ano, mes - 1 + meses, Math.min(dia, ultimoDia)))
}
