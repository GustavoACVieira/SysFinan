import { useEffect, useState } from 'react'
import { pessoas, SessaoExpirada } from './api'
import Cabecalho from './Cabecalho'
import { mascararDocumento } from './formatos'
import Listagem, { type Coluna, type Filtro, type Recarga } from './Listagem'
import type { Pessoa, PessoaEntrada, TipoPessoa } from './types'

interface Textos {
  /** Nome do tipo, ex.: "Fornecedor". */
  tipo: string
  singular: string
  /** Rótulo do campo razaoSocial no formulário. */
  nome: string
  documento: string
  exemploDocumento: string
  /** O faturado (destinatário da nota) não tem nome fantasia. */
  temFantasia: boolean
}

const TEXTOS: Record<TipoPessoa, Textos> = {
  FORNECEDOR: {
    tipo: 'Fornecedor',
    singular: 'fornecedor',
    nome: 'Razão social',
    documento: 'CNPJ / CPF',
    exemploDocumento: '00.000.000/0000-00',
    temFantasia: true,
  },
  CLIENTE: {
    tipo: 'Cliente',
    singular: 'cliente',
    nome: 'Nome / Razão social',
    documento: 'CPF / CNPJ',
    exemploDocumento: '000.000.000-00',
    temFantasia: true,
  },
  FATURADO: {
    tipo: 'Faturado',
    singular: 'faturado',
    nome: 'Nome completo / Razão social',
    documento: 'CPF / CNPJ',
    exemploDocumento: '000.000.000-00',
    temFantasia: false,
  },
}

/** Rótulos do formulário antes de escolher o tipo. */
const TEXTOS_SEM_TIPO: Textos = { ...TEXTOS.CLIENTE, tipo: '', singular: 'pessoa' }

const TIPOS = Object.keys(TEXTOS) as TipoPessoa[]

const FILTRO: Filtro = {
  rotulo: 'Filtrar por tipo de pessoa',
  todos: 'Todos os tipos',
  opcoes: TIPOS.map((t) => ({ valor: t, texto: TEXTOS[t].tipo })),
}

const COLUNAS: Coluna<Pessoa>[] = [
  { titulo: 'ID', ordem: 'idPessoas', valor: (p) => p.idPessoas, classe: 'numero' },
  {
    titulo: 'Tipo',
    ordem: 'tipo',
    valor: (p) => <span className="etiqueta">{TEXTOS[p.tipo].tipo}</span>,
  },
  { titulo: 'Nome / Razão social', ordem: 'razaoSocial', valor: (p) => p.razaoSocial },
  { titulo: 'Nome fantasia', ordem: 'fantasia', valor: (p) => p.fantasia ?? '—' },
  {
    titulo: 'CPF / CNPJ',
    ordem: 'documento',
    valor: (p) => <span className="documento">{p.documento}</span>,
  },
]

interface Props {
  aoExpirarSessao: () => void
}

/** Manter Pessoas: fornecedores, clientes e faturados numa tela só (C001_PESSOAS). */
export default function Pessoas({ aoExpirarSessao }: Props) {
  const [editando, setEditando] = useState<Pessoa | { tipo: TipoPessoa | '' } | null>(null)
  const [recarga, setRecarga] = useState<Recarga | null>(null)

  function aoSalvar(pessoa: Pessoa, nova: boolean) {
    setEditando(null)
    setRecarga({
      mensagem: `${TEXTOS[pessoa.tipo].tipo} ${nova ? 'cadastrado' : 'atualizado'}: ${pessoa.razaoSocial} (ID ${pessoa.idPessoas}).`,
    })
  }

  return (
    <>
      {/* A listagem fica montada (escondida) durante o formulário, para não perder a busca. */}
      <div hidden={editando !== null}>
        <Cabecalho
          titulo="Pessoas"
          subtitulo="Fornecedores (emitem as notas a pagar), clientes (contas a receber) e faturados (em nome de quem a nota é faturada)."
        />
        <Listagem<Pessoa>
          tituloBusca="Buscar pessoas"
          tituloLista="Lista de pessoas"
          rotulo="pessoa"
          placeholder="Buscar por nome, razão social, fantasia ou CPF/CNPJ…"
          colunas={COLUNAS}
          ordemPadrao={{ ordem: 'razaoSocial', direcao: 'asc' }}
          filtro={FILTRO}
          listar={pessoas.listar}
          inativar={pessoas.inativar}
          reativar={pessoas.reativar}
          id={(p) => p.idPessoas}
          nome={(p) => p.razaoSocial}
          aoEditar={setEditando}
          aoInserir={(tipo) => setEditando({ tipo: tipo as TipoPessoa | '' })}
          textoInserir="Inserir nova pessoa"
          recarga={recarga}
          aoExpirarSessao={aoExpirarSessao}
        />
      </div>

      {editando && (
        <FormularioPessoa
          pessoa={'idPessoas' in editando ? editando : null}
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
  /** null no cadastro. */
  pessoa: Pessoa | null
  /** No cadastro, o tipo que estava filtrado na lista ('' se nenhum). */
  tipoInicial: TipoPessoa | ''
  aoSalvar: (pessoa: Pessoa, nova: boolean) => void
  aoVoltar: () => void
  aoExpirarSessao: () => void
}

function FormularioPessoa({ pessoa, tipoInicial, aoSalvar, aoVoltar, aoExpirarSessao }: PropsFormulario) {
  const [tipo, setTipo] = useState<TipoPessoa | ''>(pessoa?.tipo ?? tipoInicial)
  const [razaoSocial, setRazaoSocial] = useState(pessoa?.razaoSocial ?? '')
  const [fantasia, setFantasia] = useState(pessoa?.fantasia ?? '')
  const [documento, setDocumento] = useState(pessoa?.documento ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const t = tipo ? TEXTOS[tipo] : TEXTOS_SEM_TIPO

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tipo) return setErro('Escolha o tipo de pessoa.')
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
        titulo={pessoa ? `Editar ${t.singular}` : 'Nova pessoa'}
        subtitulo={pessoa ? `ID ${pessoa.idPessoas}${pessoa.status === 'INATIVO' ? ' · INATIVO' : ''}` : undefined}
        aoVoltar={aoVoltar}
      />

      <form className="painel" onSubmit={enviar}>
        <h2>Formulário de pessoa</h2>

        <div className="grade-formulario">
          <label className="campo campo-inteiro campo-curto">
            <span className="campo-rotulo">Tipo</span>
            <select
              className="entrada"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoPessoa | '')}
              required
              disabled={salvando || pessoa !== null}
              autoFocus={pessoa === null && !tipo}
            >
              <option value="">Selecione…</option>
              {TIPOS.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {TEXTOS[opcao].tipo}
                </option>
              ))}
            </select>
            {pessoa && (
              <span className="dica">O tipo não muda depois do cadastro: as contas dependem dele.</span>
            )}
          </label>

          <label className="campo campo-inteiro">
            <span className="campo-rotulo">{t.nome}</span>
            <input
              className="entrada"
              value={razaoSocial}
              onChange={(e) => setRazaoSocial(e.target.value)}
              maxLength={150}
              autoFocus={pessoa !== null || tipo !== ''}
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
