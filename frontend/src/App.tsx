import { useCallback, useEffect, useState } from 'react'
import { obterStatusChave, obterToken, sair, SessaoExpirada } from './api'
import ChaveApi from './ChaveApi'
import Extracao from './Extracao'
import Login from './Login'
import type { StatusChaveApi } from './types'

type Tema = 'claro' | 'escuro'

const CHAVE_TEMA = 'sysfinan:tema'

function temaInicial(): Tema {
  const salvo = localStorage.getItem(CHAVE_TEMA)
  if (salvo === 'claro' || salvo === 'escuro') return salvo
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

export default function App() {
  const [tema, setTema] = useState<Tema>(temaInicial)
  const [logado, setLogado] = useState(() => obterToken() !== null)

  useEffect(() => {
    document.documentElement.dataset.tema = tema
    localStorage.setItem(CHAVE_TEMA, tema)
  }, [tema])

  // Estável: o Inicio usa como dependência do efeito que consulta a chave.
  const expirarSessao = useCallback(() => setLogado(false), [])

  async function encerrarSessao() {
    await sair()
    setLogado(false)
  }

  return (
    <>
      <header className="barra">
        <span className="marca">SysFinan</span>
        <div className="barra-acoes">
          {logado && (
            <button type="button" className="botao-texto" onClick={encerrarSessao}>
              Sair
            </button>
          )}
          <button
            type="button"
            className="botao-tema"
            onClick={() => setTema(tema === 'claro' ? 'escuro' : 'claro')}
            aria-label={tema === 'claro' ? 'Ativar modo escuro' : 'Ativar modo claro'}
            title={tema === 'claro' ? 'Modo escuro' : 'Modo claro'}
          >
            {tema === 'claro' ? <IconeLua /> : <IconeSol />}
          </button>
        </div>
      </header>

      {logado ? (
        <Inicio aoExpirarSessao={expirarSessao} />
      ) : (
        <Login aoEntrar={() => setLogado(true)} />
      )}
    </>
  )
}

function Inicio({ aoExpirarSessao }: { aoExpirarSessao: () => void }) {
  const [status, setStatus] = useState<StatusChaveApi | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    obterStatusChave()
      .then(setStatus)
      .catch((e) => {
        if (e instanceof SessaoExpirada) return aoExpirarSessao()
        setErro(e instanceof Error ? e.message : 'Não foi possível consultar a chave da API')
      })
  }, [aoExpirarSessao])

  return (
    <main className="pagina">
      <h1>Extração de dados de nota fiscal</h1>
      <p className="subtitulo">
        Carregue o PDF da nota fiscal para extrair os dados de contas a pagar.
      </p>

      {erro && <p className="erro erro-topo">{erro}</p>}

      <ChaveApi status={status} aoAlterar={setStatus} aoExpirarSessao={aoExpirarSessao} />
      <Extracao chaveInformada={status?.informada ?? false} aoExpirarSessao={aoExpirarSessao} />
    </main>
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
