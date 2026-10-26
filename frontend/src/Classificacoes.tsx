import { useEffect, useState } from 'react'
import { classificacoes, SessaoExpirada } from './api'
import Cabecalho from './Cabecalho'
import Listagem, { type Coluna, type Recarga } from './Listagem'
import type { Classificacao, TipoClassificacao } from './types'

const TEXTOS: Record<TipoClassificacao, { titulo: string; subtitulo: string; singular: string }> = {
  RECEITA: {
    titulo: 'Tipos de receita',
    subtitulo: 'Classificação das contas a receber.',
    singular: 'tipo de receita',
  },
  DESPESA: {
    titulo: 'Tipos de despesa',
    subtitulo:
      'Classificação das contas a pagar. O agent classifica as notas nas despesas ativas e só ' +
      'sugere uma nova quando nenhuma serve; uma despesa inativa não pode ser recriada por ele.',
    singular: 'tipo de despesa',
  },
}

const COLUNAS: Coluna<Classificacao>[] = [
  { titulo: 'ID', ordem: 'idClassificacao', valor: (c) => c.idClassificacao, classe: 'numero' },
  { titulo: 'Descrição', ordem: 'descricao', valor: (c) => c.descricao },
]

interface Props {
  tipo: TipoClassificacao
  aoExpirarSessao: () => void
}

/** Manter Classificação: tipos de receita e de despesa (C002_CLASSIFICACAO). */
export default function Classificacoes({ tipo, aoExpirarSessao }: Props) {
  const t = TEXTOS[tipo]
  const [editando, setEditando] = useState<Classificacao | 'nova' | null>(null)
  const [recarga, setRecarga] = useState<Recarga | null>(null)

  function aoSalvar(classificacao: Classificacao, nova: boolean) {
    setEditando(null)
    setRecarga({
      mensagem: `Tipo de ${tipo.toLowerCase()} ${nova ? 'cadastrado' : 'atualizado'}: ${classificacao.descricao} (ID ${classificacao.idClassificacao}).`,
    })
  }

  return (
    <>
      <div hidden={editando !== null}>
        <Cabecalho titulo={t.titulo} subtitulo={t.subtitulo} />
        <Listagem<Classificacao>
          tituloBusca={`Buscar ${t.titulo.toLowerCase()}`}
          tituloLista={`Lista de ${t.titulo.toLowerCase()}`}
          rotulo={t.singular}
          placeholder="Buscar pela descrição…"
          colunas={COLUNAS}
          ordemPadrao={{ ordem: 'descricao', direcao: 'asc' }}
          listar={(consulta) => classificacoes.listar({ ...consulta, tipo })}
          inativar={classificacoes.inativar}
          reativar={classificacoes.reativar}
          id={(c) => c.idClassificacao}
          nome={(c) => c.descricao}
          aoEditar={setEditando}
          aoInserir={() => setEditando('nova')}
          textoInserir={`Inserir novo ${t.singular}`}
          recarga={recarga}
          explicacaoExclusao={
            <>
              O registro não é apagado: fica <strong>INATIVO</strong>, sai das listas e não pode ser
              usado em novas contas
              {tipo === 'DESPESA' && ' nem pelo agent na classificação das notas'}. Para desfazer,
              reative-o em <strong>Inativos</strong>.
            </>
          }
          aoExpirarSessao={aoExpirarSessao}
        />
      </div>

      {editando && (
        <FormularioClassificacao
          tipo={tipo}
          classificacao={editando === 'nova' ? null : editando}
          aoSalvar={aoSalvar}
          aoVoltar={() => setEditando(null)}
          aoExpirarSessao={aoExpirarSessao}
        />
      )}
    </>
  )
}

interface PropsFormulario {
  tipo: TipoClassificacao
  classificacao: Classificacao | null
  aoSalvar: (classificacao: Classificacao, nova: boolean) => void
  aoVoltar: () => void
  aoExpirarSessao: () => void
}

function FormularioClassificacao({
  tipo,
  classificacao,
  aoSalvar,
  aoVoltar,
  aoExpirarSessao,
}: PropsFormulario) {
  const t = TEXTOS[tipo]
  const [descricao, setDescricao] = useState(classificacao?.descricao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
        titulo={classificacao ? `Editar ${t.singular}` : `Novo ${t.singular}`}
        subtitulo={
          classificacao
            ? `ID ${classificacao.idClassificacao}${classificacao.status === 'INATIVO' ? ' · INATIVO' : ''}`
            : undefined
        }
        aoVoltar={aoVoltar}
      />

      <form className="painel" onSubmit={enviar}>
        <h2>Formulário de {t.singular}</h2>

        <div className="grade-formulario">
          <label className="campo campo-inteiro">
            <span className="campo-rotulo">Descrição</span>
            <input
              className="entrada entrada-maiuscula"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={100}
              autoFocus
              required
              disabled={salvando}
            />
            <span className="dica">
              Gravada em maiúsculas. Nomes equivalentes (com ou sem acento, no singular ou no
              plural) contam como o mesmo {t.singular}.
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
