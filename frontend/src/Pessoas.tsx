import { useEffect, useState } from 'react'
import { pessoas, SessaoExpirada } from './api'
import Cabecalho from './Cabecalho'
import { mascararDocumento } from './formatos'
import Listagem, { type Coluna, type Recarga } from './Listagem'
import type { Pessoa, PessoaEntrada, TipoPessoa } from './types'

interface Textos {
  titulo: string
  subtitulo: string
  singular: string
  plural: string
  /** Rótulo do campo razaoSocial no formulário e na tabela. */
  nome: string
  colunaNome: string
  documento: string
  exemploDocumento: string
  /** O faturado (destinatário da nota) não tem nome fantasia. */
  temFantasia: boolean
}

const TEXTOS: Record<TipoPessoa, Textos> = {
  FORNECEDOR: {
    titulo: 'Fornecedores',
    subtitulo: 'Quem emite as notas das contas a pagar.',
    singular: 'fornecedor',
    plural: 'fornecedores',
    nome: 'Razão social',
    colunaNome: 'Razão social',
    documento: 'CNPJ / CPF',
    exemploDocumento: '00.000.000/0000-00',
    temFantasia: true,
  },
  CLIENTE: {
    titulo: 'Clientes',
    subtitulo: 'Para quem são as contas a receber.',
    singular: 'cliente',
    plural: 'clientes',
    nome: 'Nome / Razão social',
    colunaNome: 'Nome / Razão social',
    documento: 'CPF / CNPJ',
    exemploDocumento: '000.000.000-00',
    temFantasia: true,
  },
  FATURADO: {
    titulo: 'Faturados',
    subtitulo: 'Em nome de quem as notas são faturadas (o destinatário da nota).',
    singular: 'faturado',
    plural: 'faturados',
    nome: 'Nome completo / Razão social',
    colunaNome: 'Nome',
    documento: 'CPF / CNPJ',
    exemploDocumento: '000.000.000-00',
    temFantasia: false,
  },
}

interface Props {
  tipo: TipoPessoa
  aoExpirarSessao: () => void
}

/** Manter Pessoas: fornecedores, clientes e faturados (C001_PESSOAS). */
export default function Pessoas({ tipo, aoExpirarSessao }: Props) {
  const t = TEXTOS[tipo]
  const [editando, setEditando] = useState<Pessoa | 'nova' | null>(null)
  const [recarga, setRecarga] = useState<Recarga | null>(null)

  const colunas: Coluna<Pessoa>[] = [
    { titulo: 'ID', ordem: 'idPessoas', valor: (p) => p.idPessoas, classe: 'numero' },
    { titulo: t.colunaNome, ordem: 'razaoSocial', valor: (p) => p.razaoSocial },
    ...(t.temFantasia
      ? [{ titulo: 'Nome fantasia', ordem: 'fantasia', valor: (p: Pessoa) => p.fantasia ?? '—' }]
      : []),
    {
      titulo: t.documento,
      ordem: 'documento',
      valor: (p) => <span className="documento">{p.documento}</span>,
    },
  ]

  function aoSalvar(pessoa: Pessoa, nova: boolean) {
    setEditando(null)
    setRecarga({
      mensagem: `${capitalizar(t.singular)} ${nova ? 'cadastrado' : 'atualizado'}: ${pessoa.razaoSocial} (ID ${pessoa.idPessoas}).`,
    })
  }

  return (
    <>
      {/* A listagem fica montada (escondida) durante o formulário, para não perder a busca. */}
      <div hidden={editando !== null}>
        <Cabecalho titulo={t.titulo} subtitulo={t.subtitulo} />
        <Listagem<Pessoa>
          tituloBusca={`Buscar ${t.plural}`}
          tituloLista={`Lista de ${t.plural}`}
          rotulo={t.singular}
          placeholder={`Buscar por ${t.colunaNome.toLowerCase()}${t.temFantasia ? ', fantasia' : ''} ou CPF/CNPJ…`}
          colunas={colunas}
          ordemPadrao={{ ordem: 'razaoSocial', direcao: 'asc' }}
          listar={(consulta) => pessoas.listar({ ...consulta, tipo })}
          inativar={pessoas.inativar}
          reativar={pessoas.reativar}
          id={(p) => p.idPessoas}
          nome={(p) => p.razaoSocial}
          aoEditar={setEditando}
          aoInserir={() => setEditando('nova')}
          textoInserir={`Inserir novo ${t.singular}`}
          recarga={recarga}
          aoExpirarSessao={aoExpirarSessao}
        />
      </div>

      {editando && (
        <FormularioPessoa
          tipo={tipo}
          pessoa={editando === 'nova' ? null : editando}
          aoSalvar={aoSalvar}
          aoVoltar={() => setEditando(null)}
          aoExpirarSessao={aoExpirarSessao}
        />
      )}
    </>
  )
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

interface PropsFormulario {
  tipo: TipoPessoa
  /** null no cadastro. */
  pessoa: Pessoa | null
  aoSalvar: (pessoa: Pessoa, nova: boolean) => void
  aoVoltar: () => void
  aoExpirarSessao: () => void
}

function FormularioPessoa({ tipo, pessoa, aoSalvar, aoVoltar, aoExpirarSessao }: PropsFormulario) {
  const t = TEXTOS[tipo]
  const [razaoSocial, setRazaoSocial] = useState(pessoa?.razaoSocial ?? '')
  const [fantasia, setFantasia] = useState(pessoa?.fantasia ?? '')
  const [documento, setDocumento] = useState(pessoa?.documento ?? '')
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
    const dados: PessoaEntrada = {
      tipo,
      razaoSocial: razaoSocial.trim(),
      fantasia: t.temFantasia ? fantasia.trim() || null : (pessoa?.fantasia ?? null),
      documento,
    }
    try {
      const salva = pessoa ? await pessoas.editar(pessoa.idPessoas, dados) : await pessoas.criar(dados)
      aoSalvar(salva, pessoa === null)
    } catch (e) {
      if (e instanceof SessaoExpirada) return aoExpirarSessao()
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar')
      setSalvando(false)
    }
  }

  return (
    <>
      <Cabecalho
        titulo={pessoa ? `Editar ${t.singular}` : `Novo ${t.singular}`}
        subtitulo={pessoa ? `ID ${pessoa.idPessoas}${pessoa.status === 'INATIVO' ? ' · INATIVO' : ''}` : undefined}
        aoVoltar={aoVoltar}
      />

      <form className="painel" onSubmit={enviar}>
        <h2>Formulário de {t.singular}</h2>

        <div className="grade-formulario">
          <label className="campo campo-inteiro">
            <span className="campo-rotulo">{t.nome}</span>
            <input
              className="entrada"
              value={razaoSocial}
              onChange={(e) => setRazaoSocial(e.target.value)}
              maxLength={150}
              autoFocus
              required
              disabled={salvando}
            />
          </label>

          {t.temFantasia && (
            <label className="campo campo-metade">
              <span className="campo-rotulo">
                Nome fantasia <span className="opcional">(opcional)</span>
              </span>
              <input
                className="entrada"
                value={fantasia}
                onChange={(e) => setFantasia(e.target.value)}
                maxLength={150}
                disabled={salvando}
              />
            </label>
          )}

          <label className="campo campo-metade">
            <span className="campo-rotulo">{t.documento}</span>
            <input
              className="entrada documento"
              inputMode="numeric"
              placeholder={t.exemploDocumento}
              value={documento}
              onChange={(e) => setDocumento(mascararDocumento(e.target.value))}
              required
              disabled={salvando}
            />
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
