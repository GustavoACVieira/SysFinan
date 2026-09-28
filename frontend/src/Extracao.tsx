import { useState } from 'react'
import { extrairDados, SessaoExpirada } from './api'
import type { NotaFiscalExtraida } from './types'

interface Props {
  chaveInformada: boolean
  aoExpirarSessao: () => void
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function Extracao({ chaveInformada, aoExpirarSessao }: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [dados, setDados] = useState<NotaFiscalExtraida | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  function selecionarArquivo(event: React.ChangeEvent<HTMLInputElement>) {
    setArquivo(event.target.files?.[0] ?? null)
    setDados(null)
    setErro(null)
  }

  async function solicitarExtracao() {
    if (!arquivo) return

    setCarregando(true)
    setErro(null)
    setDados(null)

    try {
      setDados(await extrairDados(arquivo))
    } catch (e) {
      if (e instanceof SessaoExpirada) return aoExpirarSessao()
      setErro(e instanceof Error ? e.message : 'Erro inesperado na extração')
    } finally {
      setCarregando(false)
    }
  }

  async function copiarJson() {
    if (!dados) return
    await navigator.clipboard.writeText(JSON.stringify(dados, null, 2))
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <>
      <section className="painel">
        <h2>Nota fiscal</h2>

        <div className="campo-arquivo">
          <input
            id="arquivo"
            className="entrada-arquivo"
            type="file"
            accept="application/pdf"
            onChange={selecionarArquivo}
            disabled={carregando}
          />
          <label htmlFor="arquivo" className="botao-secundario">
            {arquivo ? 'Trocar arquivo' : 'Escolher arquivo'}
          </label>

          {arquivo ? (
            <span className="arquivo">
              <span className="arquivo-nome">{arquivo.name}</span>
              <span className="arquivo-tamanho">{formatarTamanho(arquivo.size)}</span>
            </span>
          ) : (
            <span className="arquivo-vazio">Nenhum arquivo selecionado</span>
          )}
        </div>

        <button
          type="button"
          className="botao-primario botao-extrair"
          onClick={solicitarExtracao}
          disabled={!arquivo || carregando || !chaveInformada}
        >
          {carregando ? 'Extraindo…' : 'Extrair dados'}
        </button>

        {!chaveInformada && (
          <p className="dica">Informe a chave da API do Gemini acima para liberar a extração.</p>
        )}
        {erro && <p className="erro">{erro}</p>}
      </section>

      {dados && (
        <section className="painel">
          <div className="painel-cabecalho">
            <h2>Dados extraídos</h2>
            <button type="button" className="botao-secundario" onClick={copiarJson}>
              {copiado ? 'Copiado' : 'Copiar JSON'}
            </button>
          </div>

          <pre className="json">{JSON.stringify(dados, null, 2)}</pre>
        </section>
      )}
    </>
  )
}
