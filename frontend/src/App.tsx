import { useEffect, useState } from 'react'
import { extrairDados } from './api'
import type { NotaFiscalExtraida } from './types'

type Tema = 'claro' | 'escuro'

const CHAVE_TEMA = 'sysfinan:tema'

function temaInicial(): Tema {
  const salvo = localStorage.getItem(CHAVE_TEMA)
  if (salvo === 'claro' || salvo === 'escuro') return salvo
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function App() {
  const [tema, setTema] = useState<Tema>(temaInicial)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [dados, setDados] = useState<NotaFiscalExtraida | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.tema = tema
    localStorage.setItem(CHAVE_TEMA, tema)
  }, [tema])

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
      <header className="barra">
        <span className="marca">SysFinan</span>
        <button
          type="button"
          className="botao-tema"
          onClick={() => setTema(tema === 'claro' ? 'escuro' : 'claro')}
          aria-label={tema === 'claro' ? 'Ativar modo escuro' : 'Ativar modo claro'}
          title={tema === 'claro' ? 'Modo escuro' : 'Modo claro'}
        >
          {tema === 'claro' ? <IconeLua /> : <IconeSol />}
        </button>
      </header>

      <main className="pagina">
        <h1>Extração de dados de nota fiscal</h1>
        <p className="subtitulo">
          Carregue o PDF da nota fiscal para extrair os dados de contas a pagar.
        </p>

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
            className="botao-primario"
            onClick={solicitarExtracao}
            disabled={!arquivo || carregando}
          >
            {carregando ? 'Extraindo…' : 'Extrair dados'}
          </button>

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
      </main>
    </>
  )
}

function IconeLua() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

function IconeSol() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}
