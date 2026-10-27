import { useEffect, useState } from 'react'
import { classificacoes, SessaoExpirada } from './api'
import Cabecalho from './Cabecalho'
import Listagem, { type Coluna, type Filtro, type Recarga } from './Listagem'
import type { Classificacao, TipoClassificacao } from './types'

const TEXTOS: Record<TipoClassificacao, { tipo: string; singular: string }> = {
  RECEITA: { tipo: 'Receita', singular: 'tipo de receita' },
  DESPESA: { tipo: 'Despesa', singular: 'tipo de despesa' },
}

const TIPOS = Object.keys(TEXTOS) as TipoClassificacao[]

const FILTRO: Filtro = {
  rotulo: 'Filtrar por tipo de classificação',
  todos: 'Receitas e despesas',
  opcoes: TIPOS.map((t) => ({ valor: t, texto: TEXTOS[t].tipo })),
}

const COLUNAS: Coluna<Classificacao>[] = [
  { titulo: 'ID', ordem: 'idClassificacao', valor: (c) => c.idClassificacao, classe: 'numero' },
  {
    titulo: 'Tipo',
    ordem: 'tipo',
    valor: (c) => <span className="etiqueta">{TEXTOS[c.tipo].tipo}</span>,
  },
  { titulo: 'Descrição', ordem: 'descricao', valor: (c) => c.descricao },
]

interface Props {
  aoExpirarSessao: () => void
}

/** Manter Classificação: tipos de receita e de despesa numa tela só (C002_CLASSIFICACAO). */
export default function Classificacoes({ aoExpirarSessao }: Props) {
  const [editando, setEditando] = useState<Classificacao | { tipo: TipoClassificacao | '' } | null>(
    null,
  )
  const [recarga, setRecarga] = useState<Recarga | null>(null)

  function aoSalvar(classificacao: Classificacao, nova: boolean) {
    setEditando(null)
    setRecarga({
      mensagem: `Tipo de ${classificacao.tipo.toLowerCase()} ${nova ? 'cadastrado' : 'atualizado'}: ${classificacao.descricao} (ID ${classificacao.idClassificacao}).`,
    })
  }

  return (
    <>
      <div hidden={editando !== null}>
        <Cabecalho
          titulo="Classificações"
          subtitulo={
            'Tipos de receita (contas a receber) e de despesa (contas a pagar). O agent classifica ' +
            'as notas nas despesas ativas e só sugere uma nova quando nenhuma serve; uma despesa ' +
            'inativa não pode ser recriada por ele.'
          }
        />
        <Listagem<Classificacao>
          tituloBusca="Buscar classificações"
          tituloLista="Lista de classificações"
          rotulo="classificação"
          placeholder="Buscar pela descrição…"
          colunas={COLUNAS}
          ordemPadrao={{ ordem: 'descricao', direcao: 'asc' }}
          filtro={FILTRO}
          listar={classificacoes.listar}
          inativar={classificacoes.inativar}
          reativar={classificacoes.reativar}
          id={(c) => c.idClassificacao}
          nome={(c) => c.descricao}
          aoEditar={setEditando}
          aoInserir={(tipo) => setEditando({ tipo: tipo as TipoClassificacao | '' })}
          textoInserir="Inserir nova classificação"
          recarga={recarga}
          explicacaoExclusao={
            <>
              O registro não é apagado: fica <strong>INATIVO</strong>, sai das listas e não pode ser
              usado em novas contas (uma despesa inativa também deixa de ser usada pelo agent). Para
              desfazer, reative-o em <strong>Inativos</strong>.
            </>
          }
          aoExpirarSessao={aoExpirarSessao}
        />
      </div>

      {editando && (
        <FormularioClassificacao
          classificacao={'idClassificacao' in editando ? editando : null}
          tipoInicial={editando.tipo}
          aoSalvar={aoSalvar}
          aoVoltar={() => setEditando(null)}
          aoExpirarSessao={aoExpirarSessao}
        />
      )}
    </>
  )
}

interface PropsFormulario {
  classificacao: Classificacao | null
  /** No cadastro, o tipo que estava filtrado na lista ('' se nenhum). */
  tipoInicial: TipoClassificacao | ''
  aoSalvar: (classificacao: Classificacao, nova: boolean) => void
  aoVoltar: () => void
  aoExpirarSessao: () => void
}

function FormularioClassificacao({
  classificacao,
  tipoInicial,
  aoSalvar,
  aoVoltar,
  aoExpirarSessao,
}: PropsFormulario) {
  const [tipo, setTipo] = useState<TipoClassificacao | ''>(classificacao?.tipo ?? tipoInicial)
  const [descricao, setDescricao] = useState(classificacao?.descricao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const singular = tipo ? TEXTOS[tipo].singular : 'classificação'

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tipo) return setErro('Escolha se é receita ou despesa.')
    setSalvando(true)
    setErro(null)

    // Sem status: o back-end grava ATIVO no cadastro e não o altera na edição.
    const dados = { tipo, descricao: descricao.trim() }
    try {
      const salva = classificacao
        ? await classificacoes.editar(classificacao.idClassificacao, dados)
        : await classificacoes.criar(dados)
      aoSalvar(salva, classificacao === null)
    } catch (e) {
      if (e instanceof SessaoExpirada) return aoExpirarSessao()
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar')
      setSalvando(false)
    }
  }

  return (
    <>
      <Cabecalho
        titulo={classificacao ? `Editar ${singular}` : 'Nova classificação'}
        subtitulo={
          classificacao
            ? `ID ${classificacao.idClassificacao}${classificacao.status === 'INATIVO' ? ' · INATIVO' : ''}`
            : undefined
        }
        aoVoltar={aoVoltar}
      />

      <form className="painel" onSubmit={enviar}>
        <h2>Formulário de classificação</h2>

        <div className="grade-formulario">
          <label className="campo campo-inteiro campo-curto">
            <span className="campo-rotulo">Tipo</span>
            <select
              className="entrada"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoClassificacao | '')}
              required
              disabled={salvando || classificacao !== null}
              autoFocus={classificacao === null && !tipo}
            >
              <option value="">Selecione…</option>
              {TIPOS.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {TEXTOS[opcao].tipo}
                </option>
              ))}
            </select>
            {classificacao && (
              <span className="dica">O tipo não muda depois do cadastro: as contas dependem dele.</span>
            )}
          </label>

          <label className="campo campo-inteiro">
            <span className="campo-rotulo">Descrição</span>
            <input
              className="entrada entrada-maiuscula"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={100}
              autoFocus={classificacao !== null || tipo !== ''}
              required
              disabled={salvando}
            />
            <span className="dica">
              Gravada em maiúsculas. Nomes equivalentes (com ou sem acento, no singular ou no
              plural) contam como o mesmo {singular}.
            </span>
          </label>
        </div>

        <div className="acoes-formulario">
          <button type="submit" className="botao-primario" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="botao-secundario" onClick={aoVoltar} disabled={salvando}>
            Cancelar
          </button>
        </div>

        {erro && <p className="erro">{erro}</p>}
      </form>
    </>
  )
}
