import { useCallback, useEffect, useState } from 'react'
import { obterStatusChave, obterToken, sair, SessaoExpirada } from './api'
import ChaveApi from './ChaveApi'
import Extracao from './Extracao'
import Login from './Login'
import Marca from './Marca'
import SaudeAgent from './SaudeAgent'
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
  const [status, setStatus] = useState<StatusChaveApi | null>(null)
  const [erroChave, setErroChave] = useState<string | null>(null)
  const [janelaChave, setJanelaChave] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.tema = tema
    localStorage.setItem(CHAVE_TEMA, tema)
  }, [tema])

  // Estável: é dependência do efeito que consulta a chave.
  const expirarSessao = useCallback(() => setLogado(false), [])

  useEffect(() => {
    if (!logado) {
      setStatus(null)
      setJanelaChave(false)
      return
    }
    setErroChave(null)
    obterStatusChave()
      .then(setStatus)
      .catch((e) => {
        if (e instanceof SessaoExpirada) return expirarSessao()
        setErroChave(e instanceof Error ? e.message : 'Não foi possível consultar a chave da API')
      })
  }, [logado, expirarSessao])

  async function encerrarSessao() {
    await sair()
    setLogado(false)
  }

  const chaveInformada = status?.informada ?? false

  return (
    <>
      <header className="barra">
        {/* No login a marca já aparece grande no centro; aqui só depois de entrar. */}
        {logado ? (
          <span className="marca">
            <Marca tamanho={28} />
            <NomeMarca />
          </span>
        ) : (
          <span />
        )}
        <div className="barra-acoes">
          {logado && (
            <>
              <BotaoChave status={status} aoClicar={() => setJanelaChave(true)} />
              <button type="button" className="botao-texto" onClick={encerrarSessao}>
                Sair
              </button>
            </>
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
        <main className="pagina">
          <h1 className="titulo-pagina">Extração de dados de nota fiscal</h1>
          <p className="subtitulo">
            Carregue o PDF da nota fiscal para extrair os dados de contas a pagar.
          </p>

          {erroChave && <p className="erro erro-topo">{erroChave}</p>}

          <SaudeAgent chaveInformada={chaveInformada} aoExpirarSessao={expirarSessao} />
          <Extracao
            chaveInformada={chaveInformada}
            aoInformarChave={() => setJanelaChave(true)}
            aoExpirarSessao={expirarSessao}
          />

          <ChaveApi
            aberta={janelaChave}
            aoFechar={() => setJanelaChave(false)}
            status={status}
            aoAlterar={setStatus}
            aoExpirarSessao={expirarSessao}
          />
        </main>
      ) : (
        <Login aoEntrar={() => setLogado(true)} />
      )}
    </>
  )
}

/** "SysFinan" nas cores da marca. */
function NomeMarca() {
  return (
    <span className="marca-nome">
      <span className="marca-sys">Sys</span>
      <span className="marca-finan">Finan</span>
    </span>
  )
}

/** Botão do cabeçalho que mostra a situação da chave e abre a janela para informá-la. */
function BotaoChave({ status, aoClicar }: { status: StatusChaveApi | null; aoClicar: () => void }) {
  const situacao = !status ? 'verificando' : status.informada ? 'ativa' : 'inativa'
  const descricao = !status
    ? 'Verificando a chave da API'
    : status.informada
      ? `Chave da API ativa (${status.mascara})`
      : 'Chave da API não informada'

  return (
    <button
      type="button"
      className={`botao-chave botao-chave-${situacao}`}
      onClick={aoClicar}
      title={descricao}
      aria-label={`${descricao}. Abrir configuração da chave`}
    >
      <span className="selo-ponto" aria-hidden="true" />
      Chave API
    </button>
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
