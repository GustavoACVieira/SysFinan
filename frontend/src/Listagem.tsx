import { useEffect, useRef, useState } from 'react'
import { SessaoExpirada } from './api'
import Confirmacao from './Confirmacao'
import type { Consulta, Direcao, Status } from './types'

export interface Coluna<T> {
  titulo: string
  /** Campo de ordenação no back-end (`ordem=`); sem ele a coluna não ordena. */
  ordem?: string
  valor: (item: T) => React.ReactNode
  /** 'numero' alinha à direita. */
  classe?: string
}

export interface Ordem {
  ordem: string
  direcao: Direcao
}

/** Pedido do formulário, depois de salvar: refaz a última consulta e mostra a mensagem. */
export interface Recarga {
  mensagem: string
}

interface ConsultaFeita {
  busca: string
  status: Status
}

interface Props<T> {
  tituloBusca: string
  tituloLista: string
  /** Nome do cadastro no singular, ex.: "fornecedor". */
  rotulo: string
  placeholder: string
  colunas: Coluna<T>[]
  ordemPadrao: Ordem
  listar: (consulta: Consulta) => Promise<T[]>
  inativar: (id: number) => Promise<unknown>
  reativar: (id: number) => Promise<unknown>
  id: (item: T) => number
  nome: (item: T) => string
  aoEditar: (item: T) => void
  aoInserir: () => void
  textoInserir: string
  recarga: Recarga | null
  /** Já abre buscando este termo (ex.: vindo do lançamento da nota). */
  buscaInicial?: string | null
  /** O que a exclusão lógica faz com este cadastro, na janela de confirmação. */
  explicacaoExclusao?: React.ReactNode
  aoExpirarSessao: () => void
}

const EXPLICACAO_PADRAO = (
  <>
    O registro não é apagado: fica <strong>INATIVO</strong>, sai das listas e não pode ser usado
    em novas contas. Para desfazer, reative-o em <strong>Inativos</strong>.
  </>
)

/**
 * Listagem dos cadastros, conforme a recomendação de layout:
 * tabela vazia ao abrir; carga pela Busca (vários termos) ou por TODOS (só ATIVOS);
 * ordenação por coluna; ações Editar e Excluir (lógico: o registro fica INATIVO).
 * Os inativos aparecem em "Inativos", onde a ação passa a ser Reativar.
 */
export default function Listagem<T>({
  tituloBusca,
  tituloLista,
  rotulo,
  placeholder,
  colunas,
  ordemPadrao,
  listar,
  inativar,
  reativar,
  id,
  nome,
  aoEditar,
  aoInserir,
  textoInserir,
  recarga,
  buscaInicial,
  explicacaoExclusao = EXPLICACAO_PADRAO,
  aoExpirarSessao,
}: Props<T>) {
  const [termo, setTermo] = useState(buscaInicial ?? '')
  // Última consulta pedida (refeita ao ordenar ou salvar) e a que trouxe os itens na tela.
  const [feita, setFeita] = useState<ConsultaFeita | null>(null)
  const [exibida, setExibida] = useState<ConsultaFeita | null>(null)
  const [ordem, setOrdem] = useState(ordemPadrao)
  const [itens, setItens] = useState<T[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState<T | null>(null)
  const [ocupado, setOcupado] = useState<number | null>(null)
  // Só a resposta do último pedido vale (cliques seguidos em Buscar/Todos/colunas).
  const pedido = useRef(0)

  function tratarErro(e: unknown, padrao: string) {
    if (e instanceof SessaoExpirada) return aoExpirarSessao()
    setErro(e instanceof Error ? e.message : padrao)
  }

  async function carregar(consulta: ConsultaFeita, novaOrdem: Ordem = ordem) {
    const numero = ++pedido.current
    setFeita(consulta)
    setCarregando(true)
    setErro(null)
    try {
      const lista = await listar({ busca: consulta.busca, status: consulta.status, ...novaOrdem })
      if (numero === pedido.current) {
        setItens(lista)
        setExibida(consulta)
      }
    } catch (e) {
      if (numero === pedido.current) tratarErro(e, 'Não foi possível carregar os registros')
    } finally {
      if (numero === pedido.current) setCarregando(false)
    }
  }

  useEffect(() => {
    if (buscaInicial) carregar({ busca: buscaInicial, status: 'ATIVO' })
  }, [])

  useEffect(() => {
    if (!recarga) return
    carregar(feita ?? { busca: '', status: 'ATIVO' })
    setAviso(recarga.mensagem)
  }, [recarga])

  function buscar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAviso(null)
    carregar({ busca: termo.trim(), status: 'ATIVO' })
  }

  function todos() {
    setTermo('')
    setAviso(null)
    carregar({ busca: '', status: 'ATIVO' })
  }

  function inativos() {
    setAviso(null)
    carregar({ busca: termo.trim(), status: 'INATIVO' })
  }

  function ordenar(campo: string) {
    const nova: Ordem = {
      ordem: campo,
      direcao: ordem.ordem === campo && ordem.direcao === 'asc' ? 'desc' : 'asc',
    }
    setOrdem(nova)
    if (feita) carregar(feita, nova)
  }

  async function alterarStatus(item: T, acao: 'inativar' | 'reativar') {
    setOcupado(id(item))
    setErro(null)
    setAviso(null)
    try {
      await (acao === 'inativar' ? inativar : reativar)(id(item))
      // Saiu da situação listada (ativos ou inativos).
      setItens((atual) => atual?.filter((i) => id(i) !== id(item)) ?? null)
      setAviso(
        acao === 'inativar'
          ? `Registro inativado: ${nome(item)}. Ele continua no banco e pode ser reativado em Inativos.`
          : `Registro reativado: ${nome(item)}.`,
      )
    } catch (e) {
      tratarErro(e, acao === 'inativar' ? 'Não foi possível excluir' : 'Não foi possível reativar')
    } finally {
      setOcupado(null)
      setExcluindo(null)
    }
  }

  const vendoInativos = exibida?.status === 'INATIVO'
  const total = itens?.length ?? 0
  const resumo =
    itens &&
    exibida &&
    `${total} ${total === 1 ? 'registro' : 'registros'} ` +
      (vendoInativos ? (total === 1 ? 'inativo' : 'inativos') : total === 1 ? 'ativo' : 'ativos') +
      (exibida.busca ? ` para “${exibida.busca}”` : '')

  return (
    <>
      <section className="painel">
        <h2>{tituloBusca}</h2>
        <form className="busca" role="search" onSubmit={buscar}>
          <input
            className="entrada"
            type="search"
            placeholder={placeholder}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            aria-label={tituloBusca}
          />
          <div className="busca-botoes">
            <button type="submit" className="botao-primario">
              Buscar
            </button>
            <button type="button" className="botao-secundario" onClick={todos}>
              Todos
            </button>
            <button
              type="button"
              className="botao-secundario"
              onClick={inativos}
              title="Registros inativos (excluídos), para reativar"
            >
              Inativos
            </button>
          </div>
        </form>
        <p className="dica">
          Separe os termos por espaço para buscar por mais de um. <strong>Todos</strong> traz os
          registros ativos.
        </p>
      </section>

      <section className="painel">
        <div className="painel-cabecalho">
          <h2>{tituloLista}</h2>
          {resumo && <span className={vendoInativos ? 'selo selo-inativa' : 'selo'}>{resumo}</span>}
        </div>

        <div aria-live="polite">
          {aviso && <p className="mensagem-sucesso mensagem-topo">{aviso}</p>}
          {erro && <p className="erro erro-topo">{erro}</p>}
        </div>

        <div className="tabela-rolagem">
          <table className={carregando && itens ? 'tabela tabela-carregando' : 'tabela'} aria-busy={carregando}>
            <thead>
              <tr>
                {colunas.map((coluna) => {
                  const ativa = coluna.ordem === ordem.ordem
                  return (
                    <th
                      key={coluna.titulo}
                      scope="col"
                      className={coluna.classe}
                      aria-sort={ativa ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {coluna.ordem ? (
                        <button
                          type="button"
                          className={ativa ? 'ordenar ordenar-ativa' : 'ordenar'}
                          onClick={() => ordenar(coluna.ordem!)}
                          title={`Ordenar por ${coluna.titulo.toLowerCase()}`}
                        >
                          {coluna.titulo}
                          <span className="ordenar-seta" aria-hidden="true">
                            {ativa ? (ordem.direcao === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      ) : (
                        coluna.titulo
                      )}
                    </th>
                  )
                })}
                <th scope="col" className="coluna-acoes">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {itens && itens.length > 0 ? (
                itens.map((item) => (
                  <tr key={id(item)}>
                    {colunas.map((coluna) => (
                      <td key={coluna.titulo} className={coluna.classe}>
                        {coluna.valor(item)}
                      </td>
                    ))}
                    <td className="coluna-acoes">
                      <div className="acoes-linha">
                        <button
                          type="button"
                          className="botao-pequeno"
                          onClick={() => aoEditar(item)}
                          disabled={ocupado !== null}
                        >
                          Editar
                        </button>
                        {vendoInativos ? (
                          <button
                            type="button"
                            className="botao-pequeno"
                            onClick={() => alterarStatus(item, 'reativar')}
                            disabled={ocupado !== null}
                          >
                            {ocupado === id(item) ? 'Reativando…' : 'Reativar'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="botao-pequeno botao-pequeno-perigo"
                            onClick={() => setExcluindo(item)}
                            disabled={ocupado !== null}
                            title="Exclusão lógica: o registro fica INATIVO"
                          >
                            Excluir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={colunas.length + 1} className="tabela-vazia">
                    {carregando
                      ? 'Carregando…'
                      : itens
                        ? 'Nenhum registro encontrado.'
                        : 'Nenhum registro carregado. Use a busca ou clique em Todos.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rodape-lista">
        <button type="button" className="botao-primario" onClick={aoInserir}>
          + {textoInserir}
        </button>
      </div>

      <Confirmacao
        aberta={excluindo !== null}
        titulo={`Excluir ${rotulo}`}
        textoConfirmar="Excluir"
        ocupada={ocupado !== null}
        aoConfirmar={() => excluindo && alterarStatus(excluindo, 'inativar')}
        aoCancelar={() => setExcluindo(null)}
      >
        <p>
          Excluir <strong>{excluindo ? nome(excluindo) : ''}</strong>?
        </p>
        <p className="dica">{explicacaoExclusao}</p>
      </Confirmacao>
    </>
  )
}
