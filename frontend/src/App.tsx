import { useCallback, useEffect, useState } from 'react'
import {
  obterStatusChave,
  obterToken,
  registrarAtividade,
  sair,
  SessaoExpirada,
  sessaoOciosa,
} from './api'
import Cabecalho from './Cabecalho'
import ChaveApi from './ChaveApi'
import Classificacoes from './Classificacoes'
import Contas from './Contas'
import Extracao from './Extracao'
import Login from './Login'
import Marca from './Marca'
import Pessoas from './Pessoas'
import type { StatusChaveApi } from './types'
import { useInatividade } from './useInatividade'

type Tema = 'claro' | 'escuro'

const CHAVE_TEMA = 'sysfinan:tema'

const SAIU_POR_INATIVIDADE = 'Sessão encerrada por inatividade. Entre novamente.'
const SESSAO_TERMINOU = 'Sua sessão terminou. Entre novamente.'

/** Telas do menu; o id vai no endereço (#fornecedores), para o voltar do navegador funcionar. */
const TELAS = {
  nota: { menu: 'Lançar nota fiscal', icone: IconeNota },
  fornecedores: { menu: 'Fornecedores', icone: IconeFornecedor },
  clientes: { menu: 'Clientes', icone: IconePessoas },
  faturados: { menu: 'Faturados', icone: IconeFaturado },
  'tipos-receita': { menu: 'Tipos de receita', icone: IconeReceita },
  'tipos-despesa': { menu: 'Tipos de despesa', icone: IconeDespesa },
  'contas-pagar': { menu: 'Contas a pagar', icone: IconeContaPagar },
  'contas-receber': { menu: 'Contas a receber', icone: IconeContaReceber },
}

type Tela = keyof typeof TELAS

/** Grupos do enunciado: Manter Pessoas, Manter Classificação e Registrar Contas. */
const SECOES: { titulo: string; telas: Tela[] }[] = [
  { titulo: 'Lançamento', telas: ['nota'] },
  { titulo: 'Pessoas', telas: ['fornecedores', 'clientes', 'faturados'] },
  { titulo: 'Classificação', telas: ['tipos-receita', 'tipos-despesa'] },
  { titulo: 'Contas', telas: ['contas-pagar', 'contas-receber'] },
]

function telaDoEndereco(): Tela {
  const id = window.location.hash.slice(1)
  return id in TELAS ? (id as Tela) : 'nota'
}

function temaInicial(): Tema {
  const salvo = localStorage.getItem(CHAVE_TEMA)
  if (salvo === 'claro' || salvo === 'escuro') return salvo
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

export default function App() {
  const [tema, setTema] = useState<Tema>(temaInicial)
  // Reabrir o navegador depois do prazo de inatividade não reaproveita o login salvo.
  const [avisoLogin, setAvisoLogin] = useState(() => (sessaoOciosa() ? SAIU_POR_INATIVIDADE : null))
  const [logado, setLogado] = useState(() => obterToken() !== null && !sessaoOciosa())
  const [status, setStatus] = useState<StatusChaveApi | null>(null)
  const [erroChave, setErroChave] = useState<string | null>(null)
  const [janelaChave, setJanelaChave] = useState(false)
  const [tela, setTela] = useState<Tela>(telaDoEndereco)
  const [menuAberto, setMenuAberto] = useState(false)
  // Termo já buscado ao abrir Contas a pagar a partir do lançamento da nota.
  const [buscaInicial, setBuscaInicial] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.dataset.tema = tema
    localStorage.setItem(CHAVE_TEMA, tema)
  }, [tema])

  useEffect(() => {
    function aoMudarEndereco() {
      setTela(telaDoEndereco())
      setMenuAberto(false)
    }
    window.addEventListener('hashchange', aoMudarEndereco)
    return () => window.removeEventListener('hashchange', aoMudarEndereco)
  }, [])

  useEffect(() => {
    document.title = logado ? `${TELAS[tela].menu} — SysFinan` : 'SysFinan — Controle Financeiro'
  }, [tela, logado])

  const expirarSessao = useCallback(() => {
    setAvisoLogin(SESSAO_TERMINOU)
    setLogado(false)
  }, [])

  const encerrarPorInatividade = useCallback(() => {
    setAvisoLogin(SAIU_POR_INATIVIDADE)
    setLogado(false)
    void sair()
  }, [])

  const segundosRestantes = useInatividade(logado, encerrarPorInatividade, expirarSessao)

  useEffect(() => {
    if (sessaoOciosa()) void sair()
  }, [])

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
    setAvisoLogin(null)
    setLogado(false)
  }

  function entrar() {
    setAvisoLogin(null)
    setLogado(true)
  }

  function verConta(numeroNotaFiscal: string | null) {
    setBuscaInicial(numeroNotaFiscal)
    window.location.hash = 'contas-pagar'
  }

  const botaoTema = (
    <button
      type="button"
      className="botao-tema"
      onClick={() => setTema(tema === 'claro' ? 'escuro' : 'claro')}
      aria-label={tema === 'claro' ? 'Ativar modo escuro' : 'Ativar modo claro'}
      title={tema === 'claro' ? 'Modo escuro' : 'Modo claro'}
    >
      {tema === 'claro' ? <IconeLua /> : <IconeSol />}
    </button>
  )

  if (!logado) {
    return (
      <>
        <header className="barra">
          <span />
          <div className="barra-acoes">{botaoTema}</div>
        </header>
        <Login aoEntrar={entrar} aviso={avisoLogin} />
      </>
    )
  }

  return (
    <div className="app">
      <aside className={menuAberto ? 'lateral lateral-aberta' : 'lateral'}>
        <div className="lateral-topo">
          <span className="marca">
            <Marca tamanho={28} />
            <NomeMarca />
          </span>
          <button
            type="button"
            className="botao-menu"
            onClick={() => setMenuAberto(!menuAberto)}
            aria-expanded={menuAberto}
            aria-controls="menu-principal"
          >
            {menuAberto ? 'Fechar' : 'Menu'}
          </button>
        </div>

        <nav id="menu-principal" className="menu" aria-label="Menu principal">
          {SECOES.map((secao) => (
            <div key={secao.titulo} className="menu-grupo">
              <p className="menu-secao">{secao.titulo}</p>
              <ul>
                {secao.telas.map((id) => {
                  const Icone = TELAS[id].icone
                  return (
                    <li key={id}>
                      <a
                        href={`#${id}`}
                        className="menu-item"
                        aria-current={tela === id ? 'page' : undefined}
                        onClick={() => {
                          setBuscaInicial(null)
                          setMenuAberto(false)
                        }}
                      >
                        <Icone />
                        {TELAS[id].menu}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="lateral-rodape">
          <BotaoChave status={status} aoClicar={() => setJanelaChave(true)} />
          <div className="lateral-rodape-acoes">
            {botaoTema}
            <button type="button" className="botao-texto" onClick={encerrarSessao}>
              Sair
            </button>
          </div>
        </div>
      </aside>

      <main className="conteudo">
        {erroChave && <p className="erro erro-topo">{erroChave}</p>}

        {/* A extração fica montada fora da tela: navegar não perde o resultado nem a extração em andamento. */}
        <div hidden={tela !== 'nota'} className="conteudo-estreito">
          <Cabecalho
            titulo="Lançar nota fiscal"
            subtitulo="Extraia os dados do PDF da nota, confira no banco o fornecedor, o faturado e a despesa e lance a conta a pagar."
          />
          <Extracao
            chaveInformada={status?.informada ?? false}
            aoInformarChave={() => setJanelaChave(true)}
            aoVerConta={verConta}
            aoExpirarSessao={expirarSessao}
          />
        </div>

        {tela === 'fornecedores' && <Pessoas key={tela} tipo="FORNECEDOR" aoExpirarSessao={expirarSessao} />}
        {tela === 'clientes' && <Pessoas key={tela} tipo="CLIENTE" aoExpirarSessao={expirarSessao} />}
        {tela === 'faturados' && <Pessoas key={tela} tipo="FATURADO" aoExpirarSessao={expirarSessao} />}
        {tela === 'tipos-receita' && (
          <Classificacoes key={tela} tipo="RECEITA" aoExpirarSessao={expirarSessao} />
        )}
        {tela === 'tipos-despesa' && (
          <Classificacoes key={tela} tipo="DESPESA" aoExpirarSessao={expirarSessao} />
        )}
        {tela === 'contas-pagar' && (
          <Contas
            key={`${tela}:${buscaInicial}`}
            tipo="APAGAR"
            buscaInicial={buscaInicial}
            aoExpirarSessao={expirarSessao}
          />
        )}
        {tela === 'contas-receber' && <Contas key={tela} tipo="ARECEBER" aoExpirarSessao={expirarSessao} />}
      </main>

      {segundosRestantes !== null && (
        <div className="aviso-inatividade" role="alert">
          <span>
            Sem atividade: você será desconectado em <strong>{segundosRestantes} s</strong>.
          </span>
          {/* O clique já conta como atividade (e renova a sessão no back-end). */}
          <button type="button" className="botao-primario" onClick={registrarAtividade}>
            Continuar conectado
          </button>
        </div>
      )}

      <ChaveApi
        aberta={janelaChave}
        aoFechar={() => setJanelaChave(false)}
        status={status}
        aoAlterar={setStatus}
        aoExpirarSessao={expirarSessao}
      />
    </div>
  )
}

function NomeMarca() {
  return (
    <span className="marca-nome">
      <span className="marca-sys">Sys</span>
      <span className="marca-finan">Finan</span>
    </span>
  )
}

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

function Icone({ children }: { children: React.ReactNode }) {
  return (
    <svg className="menu-icone" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function IconeNota() {
  return (
    <Icone>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Icone>
  )
}

function IconeFornecedor() {
  return (
    <Icone>
      <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </Icone>
  )
}

function IconePessoas() {
  return (
    <Icone>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
    </Icone>
  )
}

function IconeFaturado() {
  return (
    <Icone>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 10-5.5M15.5 18l2 2 4-4.5" />
    </Icone>
  )
}

function IconeReceita() {
  return (
    <Icone>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16V8M8.5 11.5 12 8l3.5 3.5" />
    </Icone>
  )
}

function IconeDespesa() {
  return (
    <Icone>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8.5 12.5 12 16l3.5-3.5" />
    </Icone>
  )
}

function IconeContaPagar() {
  return (
    <Icone>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </Icone>
  )
}

function IconeContaReceber() {
  return (
    <Icone>
      <path d="M4 4h16v16l-3-2-3 2-2-2-2 2-3-2-3 2z" />
      <path d="M8 9h8M8 13h5" />
    </Icone>
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
