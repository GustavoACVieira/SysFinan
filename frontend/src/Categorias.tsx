import { useState } from 'react'
import { alterarSituacaoCategoria, listarCategorias, SessaoExpirada } from './api'
import Janela from './Janela'
import type { Categoria } from './types'

interface Props {
  aberta: boolean
  aoFechar: () => void
  aoExpirarSessao: () => void
}

function formatarData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : ''
}

/** Janela com as categorias de despesa: as padrão e as criadas pelo agent. */
export default function Categorias({ aberta, aoFechar, aoExpirarSessao }: Props) {
  const [lista, setLista] = useState<Categoria[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [alterando, setAlterando] = useState<string | null>(null)

  function tratarErro(e: unknown, padrao: string) {
    if (e instanceof SessaoExpirada) return aoExpirarSessao()
    setErro(e instanceof Error ? e.message : padrao)
  }

  // Recarrega a cada abertura: o agent pode ter criado uma categoria desde a última vez.
  function carregar() {
    setErro(null)
    listarCategorias()
      .then(setLista)
      .catch((e) => tratarErro(e, 'Não foi possível carregar as categorias'))
  }

  async function alternar(categoria: Categoria) {
    setAlterando(categoria.nome)
    setErro(null)
    try {
      const atualizada = await alterarSituacaoCategoria(categoria.nome, !categoria.ativa)
      setLista((atual) => atual?.map((c) => (c.nome === atualizada.nome ? atualizada : c)) ?? null)
    } catch (e) {
      tratarErro(e, 'Não foi possível alterar a categoria')
    } finally {
      setAlterando(null)
    }
  }

  const criadas = lista?.filter((c) => !c.padrao) ?? []
  const padrao = lista?.filter((c) => c.padrao) ?? []

  return (
    <Janela aberta={aberta} aoFechar={aoFechar} titulo="Categorias de despesa" aoAbrir={carregar} larga>
      <p className="dica categorias-intro">
        O agent classifica cada nota nestas categorias e só cria uma nova quando nenhuma serve.
        Inative as criadas que você não quer que ele use; ele não poderá recriá-las.
      </p>

      {erro && <p className="erro erro-topo">{erro}</p>}

      {!lista ? (
        !erro && <p className="saude-mensagem">Carregando…</p>
      ) : (
        <>
          <h3 className="categorias-secao">Criadas pelo agent</h3>
          {criadas.length === 0 ? (
            <p className="dica categorias-vazio">Nenhuma ainda.</p>
          ) : (
            <ul className="categorias-lista">
              {criadas.map((c) => (
                <li key={c.nome} className={c.ativa ? undefined : 'categoria-inativa'}>
                  <div className="categoria-corpo">
                    <div className="categoria-linha">
                      <span className="categoria-nome">{c.nome}</span>
                      <span className={`selo ${c.ativa ? 'selo-ativa' : 'selo-inativa'}`}>
                        <span className="selo-ponto" aria-hidden="true" />
                        {c.ativa ? 'Ativa' : 'Inativa'}
                      </span>
                    </div>
                    <p className="categoria-descricao">{c.descricao}</p>
                    <p className="etapa-meta">
                      Criada em {formatarData(c.criadaEm)}
                      {c.notaOrigem && ` · a partir da nota ${c.notaOrigem}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="botao-secundario"
                    onClick={() => alternar(c)}
                    disabled={alterando !== null}
                  >
                    {alterando === c.nome ? 'Salvando…' : c.ativa ? 'Inativar' : 'Reativar'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="categorias-secao">Padrão do sistema</h3>
          <ul className="categorias-lista categorias-padrao">
            {padrao.map((c) => (
              <li key={c.nome}>
                <div className="categoria-corpo">
                  <span className="categoria-nome">{c.nome}</span>
                  <p className="categoria-descricao">{c.descricao}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Janela>
  )
}
