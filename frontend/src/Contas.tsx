import { useEffect, useRef, useState } from 'react'
import { classificacoes, contas, pessoas, SessaoExpirada } from './api'
import Cabecalho from './Cabecalho'
import {
  formatarData,
  formatarReais,
  hojeIso,
  lerValor,
  somarMeses,
  valorParaCampo,
} from './formatos'
import Listagem, { type Coluna, type Filtro, type Recarga } from './Listagem'
import type {
  Classificacao,
  Conta,
  ContaEntrada,
  Pessoa,
  TipoClassificacao,
  TipoMovimento,
  TipoPessoa,
} from './types'

interface Textos {
  /** Nome do tipo na tabela e no filtro. */
  tipo: string
  singular: string
  pessoa: string
  tipoPessoa: TipoPessoa
  classificacao: string
  classificacaoSingular: string
  tipoClassificacao: TipoClassificacao
}

/** O que cada tipo de conta exige: fornecedor e despesas a pagar; cliente e receitas a receber. */
const TEXTOS: Record<TipoMovimento, Textos> = {
  APAGAR: {
    tipo: 'A pagar',
    singular: 'conta a pagar',
    pessoa: 'Fornecedor',
    tipoPessoa: 'FORNECEDOR',
    classificacao: 'Tipos de despesa',
    classificacaoSingular: 'tipo de despesa',
    tipoClassificacao: 'DESPESA',
  },
  ARECEBER: {
    tipo: 'A receber',
    singular: 'conta a receber',
    pessoa: 'Cliente',
    tipoPessoa: 'CLIENTE',
    classificacao: 'Tipos de receita',
    classificacaoSingular: 'tipo de receita',
    tipoClassificacao: 'RECEITA',
  },
}

const TIPOS = Object.keys(TEXTOS) as TipoMovimento[]

const FILTRO: Filtro = {
  rotulo: 'Filtrar por tipo de conta',
  todos: 'A pagar e a receber',
  opcoes: TIPOS.map((t) => ({ valor: t, texto: TEXTOS[t].tipo })),
}

function nomeConta(conta: Conta): string {
  const nota = conta.numeroNotaFiscal ? `NF ${conta.numeroNotaFiscal}` : `Conta ID ${conta.idMovimentoContas}`
  return `${nota} — ${conta.fornecedorCliente.razaoSocial}`
}

const COLUNAS: Coluna<Conta>[] = [
  { titulo: 'ID', ordem: 'idMovimentoContas', valor: (c) => c.idMovimentoContas, classe: 'numero' },
  {
    titulo: 'Tipo',
    ordem: 'tipo',
    valor: (c) => <span className="etiqueta">{TEXTOS[c.tipo].tipo}</span>,
    classe: 'nowrap',
  },
  { titulo: 'Nº NF', ordem: 'numeroNotaFiscal', valor: (c) => c.numeroNotaFiscal ?? '—', classe: 'nowrap' },
  { titulo: 'Emissão', ordem: 'dataEmissao', valor: (c) => formatarData(c.dataEmissao), classe: 'nowrap' },
  {
    // O faturado vai junto, numa linha abaixo: uma coluna a mais não cabe com Tipo e Parcelas.
    titulo: 'Fornecedor / Cliente',
    ordem: 'fornecedorCliente',
    valor: (c) => (
      <>
        {c.fornecedorCliente.razaoSocial}
        <span className="celula-detalhe documento">{c.fornecedorCliente.documento}</span>
        <span className="celula-detalhe">Faturado: {c.faturado.razaoSocial}</span>
      </>
    ),
  },
  {
    titulo: 'Classificação',
    valor: (c) => (
      <span className="etiquetas">
        {c.classificacoes.map((cl) => (
          <span key={cl.idClassificacao} className="etiqueta">
            {cl.descricao}
          </span>
        ))}
      </span>
    ),
  },
  {
    titulo: 'Parcelas',
    valor: (c) => (
      <ul className="lista-parcelas">
        {c.parcelas.map((p) => (
          <li key={p.idParcelaContas}>
            <span className="parcela-identificacao">{p.identificacao}</span>
            {formatarData(p.dataVencimento)}
            <span className="celula-detalhe">{formatarReais(p.valorParcela)}</span>
          </li>
        ))}
      </ul>
    ),
  },
  { titulo: 'Valor total', ordem: 'valorTotal', valor: (c) => formatarReais(c.valorTotal), classe: 'numero nowrap' },
]

interface Props {
  /** Abre já buscando este termo (o nº da nota, vindo do lançamento)... */
  buscaInicial?: string | null
  /** ...e filtrada neste tipo. */
  tipoInicial?: TipoMovimento | null
  aoExpirarSessao: () => void
}

/** Registrar Contas: a pagar e a receber numa tela só (T001_MOVIMENTOCONTAS + T002_PARCELACONTAS). */
export default function Contas({ buscaInicial, tipoInicial, aoExpirarSessao }: Props) {
  const [editando, setEditando] = useState<Conta | { tipo: TipoMovimento | '' } | null>(null)
  const [recarga, setRecarga] = useState<Recarga | null>(null)

  function aoSalvar(conta: Conta, nova: boolean) {
    setEditando(null)
    const singular = TEXTOS[conta.tipo].singular
    setRecarga({
      mensagem: `${singular.charAt(0).toUpperCase() + singular.slice(1)} ${nova ? 'registrada' : 'atualizada'}: ${nomeConta(conta)} (ID ${conta.idMovimentoContas}).`,
    })
  }

  return (
    <>
      <div hidden={editando !== null}>
        <Cabecalho
          titulo="Contas"
          subtitulo="Contas a pagar (fornecedor e despesas) e a receber (cliente e receitas), com uma ou mais classificações e uma ou mais parcelas."
        />
        <Listagem<Conta>
          tituloBusca="Buscar contas"
          tituloLista="Lista de contas"
          rotulo="conta"
          placeholder="Buscar por nº da nota, descrição ou fornecedor/cliente…"
          colunas={COLUNAS}
          ordemPadrao={{ ordem: 'dataEmissao', direcao: 'desc' }}
          filtro={FILTRO}
          listar={contas.listar}
          inativar={contas.inativar}
          reativar={contas.reativar}
          id={(c) => c.idMovimentoContas}
          nome={nomeConta}
          aoEditar={setEditando}
          aoInserir={(tipo) => setEditando({ tipo: tipo as TipoMovimento | '' })}
          textoInserir="Registrar nova conta"
          recarga={recarga}
          buscaInicial={buscaInicial}
          tipoInicial={tipoInicial}
          explicacaoExclusao={
            <>
              A conta não é apagada: fica <strong>INATIVA</strong>, com suas parcelas, e sai das
              listas. Para desfazer, reative-a em <strong>Inativos</strong>.
            </>
          }
          aoExpirarSessao={aoExpirarSessao}
        />
      </div>

      {editando && (
        <FormularioConta
          conta={'idMovimentoContas' in editando ? editando : null}
          tipoInicial={editando.tipo}
          aoSalvar={aoSalvar}
          aoVoltar={() => setEditando(null)}
          aoExpirarSessao={aoExpirarSessao}
        />
      )}
    </>
  )
}

interface ParcelaFormulario {
  chave: number
  dataVencimento: string
  valor: string
}

/** Dependem do tipo da conta: fornecedores e despesas, ou clientes e receitas. */
interface Opcoes {
  pessoas: Pessoa[]
  classificacoes: Classificacao[]
}

/** As opções são só os ATIVOS; na edição, o cadastro atual entra mesmo se tiver sido inativado. */
function comAtual<T>(lista: T[], atuais: T[], id: (item: T) => number): T[] {
  const faltando = atuais.filter((a) => !lista.some((item) => id(item) === id(a)))
  return [...lista, ...faltando]
}

function centavos(valor: number): number {
  return Math.round(valor * 100)
}

interface PropsFormulario {
  conta: Conta | null
  /** No cadastro, o tipo que estava filtrado na lista ('' se nenhum). */
  tipoInicial: TipoMovimento | ''
  aoSalvar: (conta: Conta, nova: boolean) => void
  aoVoltar: () => void
  aoExpirarSessao: () => void
}

function FormularioConta({ conta, tipoInicial, aoSalvar, aoVoltar, aoExpirarSessao }: PropsFormulario) {
  const [tipo, setTipo] = useState<TipoMovimento>(conta?.tipo ?? (tipoInicial || 'APAGAR'))
  const t = TEXTOS[tipo]
  const proximaChave = useRef(conta?.parcelas.length ?? 1)
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null)
  const [faturados, setFaturados] = useState<Pessoa[] | null>(null)
  const [idPessoa, setIdPessoa] = useState(conta ? String(conta.fornecedorCliente.idPessoas) : '')
  const [idFaturado, setIdFaturado] = useState(conta ? String(conta.faturado.idPessoas) : '')
  const [numeroNotaFiscal, setNumeroNotaFiscal] = useState(conta?.numeroNotaFiscal ?? '')
  const [dataEmissao, setDataEmissao] = useState(conta?.dataEmissao ?? hojeIso())
  const [valorTotal, setValorTotal] = useState(conta ? valorParaCampo(conta.valorTotal) : '')
  const [descricao, setDescricao] = useState(conta?.descricao ?? '')
  const [idsClassificacoes, setIdsClassificacoes] = useState<number[]>(
    conta?.classificacoes.map((c) => c.idClassificacao) ?? [],
  )
  const [parcelas, setParcelas] = useState<ParcelaFormulario[]>(
    conta
      ? conta.parcelas.map((p, i) => ({
          chave: i,
          dataVencimento: p.dataVencimento,
          valor: valorParaCampo(p.valorParcela),
        }))
      : [{ chave: 0, dataVencimento: '', valor: '' }],
  )
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function tratarErroCarga(e: unknown) {
    if (e instanceof SessaoExpirada) return aoExpirarSessao()
    setErro(e instanceof Error ? e.message : 'Não foi possível carregar os cadastros')
  }

  useEffect(() => {
    window.scrollTo({ top: 0 })
    pessoas
      .listar({ tipo: 'FATURADO' })
      .then((lista) => setFaturados(comAtual(lista, conta ? [conta.faturado] : [], (p) => p.idPessoas)))
      .catch(tratarErroCarga)
  }, [])

  useEffect(() => {
    let atual = true
    setOpcoes(null)
    Promise.all([
      pessoas.listar({ tipo: t.tipoPessoa }),
      classificacoes.listar({ tipo: t.tipoClassificacao }),
    ])
      .then(([lista, tipos]) => {
        if (!atual) return
        setOpcoes({
          pessoas: comAtual(lista, conta ? [conta.fornecedorCliente] : [], (p) => p.idPessoas),
          classificacoes: comAtual(tipos, conta?.classificacoes ?? [], (c) => c.idClassificacao),
        })
      })
      .catch(tratarErroCarga)
    return () => {
      atual = false
    }
  }, [tipo])

  /** Só no cadastro: o fornecedor/cliente e as classificações escolhidos eram do outro tipo. */
  function trocarTipo(novo: TipoMovimento) {
    setTipo(novo)
    setIdPessoa('')
    setIdsClassificacoes([])
  }

  const total = lerValor(valorTotal)
  const valores = parcelas.map((p) => lerValor(p.valor))
  const soma = valores.every((v) => v !== null)
    ? valores.reduce((acumulado: number, v) => acumulado + centavos(v!), 0) / 100
    : null

  function alterarParcela(chave: number, campo: 'dataVencimento' | 'valor', valor: string) {
    setParcelas((atual) => atual.map((p) => (p.chave === chave ? { ...p, [campo]: valor } : p)))
  }

  /** A nova parcela vence um mês depois da anterior, contando do dia da primeira. */
  function adicionarParcela() {
    setParcelas((atual) => {
      const primeira = atual[0]?.dataVencimento
      return [
        ...atual,
        {
          chave: ++proximaChave.current,
          dataVencimento: primeira ? somarMeses(primeira, atual.length) : '',
          valor: '',
        },
      ]
    })
  }

  function removerParcela(chave: number) {
    setParcelas((atual) => (atual.length > 1 ? atual.filter((p) => p.chave !== chave) : atual))
  }

  /** Divide o total igualmente; os centavos que sobram vão para as primeiras parcelas. */
  function dividirTotal() {
    if (total === null) return setErro('Informe o valor total para dividir entre as parcelas.')
    setErro(null)
    const quantidade = parcelas.length
    const base = Math.floor(centavos(total) / quantidade)
    const resto = centavos(total) - base * quantidade
    setParcelas((atual) =>
      atual.map((p, i) => ({ ...p, valor: valorParaCampo((base + (i < resto ? 1 : 0)) / 100) })),
    )
  }

  function preencherParcelaUnica() {
    if (parcelas.length === 1 && !parcelas[0].valor && total !== null) {
      alterarParcela(parcelas[0].chave, 'valor', valorParaCampo(total))
    }
  }

  function alternarClassificacao(id: number) {
    setIdsClassificacoes((atual) => (atual.includes(id) ? atual.filter((i) => i !== id) : [...atual, id]))
  }

  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErro(null)

    if (total === null) {
      return setErro('Valor total: informe um valor válido, com até 2 casas decimais (ex.: 1.234,56).')
    }
    const invalida = valores.findIndex((v) => v === null)
    if (invalida >= 0) {
      return setErro(`Parcela nº ${invalida + 1}: informe um valor válido, com até 2 casas decimais.`)
    }
    if (idsClassificacoes.length === 0) {
      return setErro(`Marque ao menos um ${t.classificacaoSingular}.`)
    }

    // Sem status: o back-end grava ATIVO no registro e não o altera na edição.
    // Soma das parcelas e vencimentos distintos são conferidos pelo back-end.
    const dados: ContaEntrada = {
      tipo,
      numeroNotaFiscal: numeroNotaFiscal.trim() || null,
      dataEmissao,
      descricao: descricao.trim() || null,
      valorTotal: total,
      idFornecedorCliente: Number(idPessoa),
      idFaturado: Number(idFaturado),
      idClassificacoes: idsClassificacoes,
      parcelas: parcelas.map((p, i) => ({ dataVencimento: p.dataVencimento, valorParcela: valores[i]! })),
    }

    setSalvando(true)
    try {
      const salva = conta ? await contas.editar(conta.idMovimentoContas, dados) : await contas.criar(dados)
      aoSalvar(salva, conta === null)
    } catch (e) {
      if (e instanceof SessaoExpirada) return aoExpirarSessao()
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar')
      setSalvando(false)
    }
  }

  const bloqueado = salvando || opcoes === null || faturados === null

  return (
    <>
      <Cabecalho
        titulo={conta ? `Editar ${t.singular}` : 'Nova conta'}
        subtitulo={
          conta ? `ID ${conta.idMovimentoContas}${conta.status === 'INATIVO' ? ' · INATIVA' : ''}` : undefined
        }
        aoVoltar={aoVoltar}
      />

      <form className="painel" onSubmit={enviar}>
        <h2>Formulário de conta</h2>

        <div className="grade-formulario">
          <label className="campo campo-inteiro campo-curto">
            <span className="campo-rotulo">Tipo</span>
            <select
              className="entrada"
              value={tipo}
              onChange={(e) => trocarTipo(e.target.value as TipoMovimento)}
              disabled={salvando || conta !== null}
            >
              {TIPOS.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {TEXTOS[opcao].tipo}
                </option>
              ))}
            </select>
            {conta && (
              <span className="dica">
                O tipo não muda depois do registro: ele define o fornecedor/cliente e as classificações.
              </span>
            )}
          </label>

          <label className="campo campo-metade">
            <span className="campo-rotulo">{t.pessoa}</span>
            <SelecaoPessoa
              pessoas={opcoes?.pessoas}
              valor={idPessoa}
              aoAlterar={setIdPessoa}
              desabilitado={bloqueado}
              vazio={`Nenhum ${t.pessoa.toLowerCase()} ativo: cadastre em Pessoas`}
            />
          </label>

          <label className="campo campo-metade">
            <span className="campo-rotulo">Faturado</span>
            <SelecaoPessoa
              pessoas={faturados ?? undefined}
              valor={idFaturado}
              aoAlterar={setIdFaturado}
              desabilitado={bloqueado}
              vazio="Nenhum faturado ativo: cadastre em Pessoas"
            />
          </label>

          <label className="campo campo-terco">
            <span className="campo-rotulo">
              Nº da nota fiscal <span className="opcional">(opcional)</span>
            </span>
            <input
              className="entrada"
              value={numeroNotaFiscal}
              onChange={(e) => setNumeroNotaFiscal(e.target.value)}
              maxLength={20}
              disabled={salvando}
            />
          </label>

          <label className="campo campo-terco">
            <span className="campo-rotulo">Data de emissão</span>
            <input
              className="entrada"
              type="date"
              value={dataEmissao}
              onChange={(e) => setDataEmissao(e.target.value)}
              required
              disabled={salvando}
            />
          </label>

          <label className="campo campo-terco">
            <span className="campo-rotulo">Valor total (R$)</span>
            <input
              className="entrada entrada-valor"
              inputMode="decimal"
              placeholder="0,00"
              value={valorTotal}
              onChange={(e) => setValorTotal(e.target.value)}
              onBlur={preencherParcelaUnica}
              required
              disabled={salvando}
            />
          </label>

          <label className="campo campo-inteiro">
            <span className="campo-rotulo">
              Descrição <span className="opcional">(opcional)</span>
            </span>
            <textarea
              className="entrada"
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              disabled={salvando}
            />
          </label>

          <fieldset className="campo campo-inteiro grupo">
            <legend className="campo-rotulo">{t.classificacao}</legend>
            {!opcoes ? (
              <p className="dica">Carregando…</p>
            ) : opcoes.classificacoes.length === 0 ? (
              <p className="dica">
                Nenhum {t.classificacaoSingular} ativo: cadastre em Classificações.
              </p>
            ) : (
              <div className="opcoes-marcar">
                {opcoes.classificacoes.map((c) => (
                  <label key={c.idClassificacao} className="opcao-marcar">
                    <input
                      type="checkbox"
                      checked={idsClassificacoes.includes(c.idClassificacao)}
                      onChange={() => alternarClassificacao(c.idClassificacao)}
                      disabled={salvando}
                    />
                    <span>
                      {c.descricao}
                      {c.status === 'INATIVO' && <span className="opcional"> (INATIVO)</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <span className="dica">Marque um ou mais.</span>
          </fieldset>

          <fieldset className="campo campo-inteiro grupo">
            <legend className="campo-rotulo">Parcelas</legend>
            <div className="tabela-rolagem">
              <table className="tabela tabela-parcelas">
                <thead>
                  <tr>
                    <th scope="col">Nº</th>
                    <th scope="col">Vencimento</th>
                    <th scope="col">Valor (R$)</th>
                    <th scope="col">
                      <span className="visualmente-oculto">Remover</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parcelas.map((p, i) => (
                    <tr key={p.chave}>
                      <td className="numero">{i + 1}</td>
                      <td>
                        <input
                          className="entrada"
                          type="date"
                          value={p.dataVencimento}
                          onChange={(e) => alterarParcela(p.chave, 'dataVencimento', e.target.value)}
                          required
                          disabled={salvando}
                          aria-label={`Vencimento da parcela ${i + 1}`}
                        />
                      </td>
                      <td>
                        <input
                          className="entrada entrada-valor"
                          inputMode="decimal"
                          placeholder="0,00"
                          value={p.valor}
                          onChange={(e) => alterarParcela(p.chave, 'valor', e.target.value)}
                          required
                          disabled={salvando}
                          aria-label={`Valor da parcela ${i + 1}`}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="botao-fechar"
                          onClick={() => removerParcela(p.chave)}
                          disabled={salvando || parcelas.length === 1}
                          aria-label={`Remover parcela ${i + 1}`}
                          title="Remover parcela"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="parcelas-rodape">
              <div className="parcelas-acoes">
                <button type="button" className="botao-secundario" onClick={adicionarParcela} disabled={salvando}>
                  + Adicionar parcela
                </button>
                <button type="button" className="botao-secundario" onClick={dividirTotal} disabled={salvando}>
                  Dividir o total igualmente
                </button>
              </div>
              <SomaParcelas soma={soma} total={total} />
            </div>
            <span className="dica">
              Cada parcela vence em uma data diferente. A identificação (ÚNICA, 1/3, 2/3…) é gerada
              ao salvar, em ordem de vencimento.
            </span>
          </fieldset>
        </div>

        <div className="acoes-formulario">
          <button type="submit" className="botao-primario" disabled={bloqueado}>
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

function SelecaoPessoa({
  pessoas,
  valor,
  aoAlterar,
  desabilitado,
  vazio,
}: {
  pessoas: Pessoa[] | undefined
  valor: string
  aoAlterar: (valor: string) => void
  desabilitado: boolean
  vazio: string
}) {
  return (
    <select
      className="entrada"
      value={valor}
      onChange={(e) => aoAlterar(e.target.value)}
      required
      disabled={desabilitado}
    >
      <option value="">
        {!pessoas ? 'Carregando…' : pessoas.length === 0 ? vazio : 'Selecione…'}
      </option>
      {pessoas?.map((p) => (
        <option key={p.idPessoas} value={p.idPessoas}>
          {p.razaoSocial} — {p.documento}
          {p.status === 'INATIVO' ? ' (INATIVO)' : ''}
        </option>
      ))}
    </select>
  )
}

function SomaParcelas({ soma, total }: { soma: number | null; total: number | null }) {
  if (soma === null) return <p className="parcelas-soma">Soma das parcelas: —</p>
  const diferenca = total === null ? null : (centavos(total) - centavos(soma)) / 100

  return (
    <p className="parcelas-soma" aria-live="polite">
      Soma das parcelas: <strong>{formatarReais(soma)}</strong>
      {diferenca === 0 && <span className="soma-confere"> · confere com o total</span>}
      {diferenca !== null && diferenca !== 0 && (
        <span className="soma-diferente">
          {' '}
          · {diferenca > 0 ? 'faltam' : 'sobram'} {formatarReais(Math.abs(diferenca))}
        </span>
      )}
    </p>
  )
}
