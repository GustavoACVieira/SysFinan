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
import Listagem, { type Coluna, type Recarga } from './Listagem'
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
  titulo: string
  subtitulo: string
  singular: string
  pessoa: string
  pessoaPlural: string
  tipoPessoa: TipoPessoa
  classificacao: string
  classificacaoSingular: string
  tipoClassificacao: TipoClassificacao
}

/** O que cada tipo de conta exige: fornecedor e despesas a pagar; cliente e receitas a receber. */
const TEXTOS: Record<TipoMovimento, Textos> = {
  APAGAR: {
    titulo: 'Contas a pagar',
    subtitulo:
      'Notas de fornecedores, classificadas em um ou mais tipos de despesa e divididas em uma ou mais parcelas.',
    singular: 'conta a pagar',
    pessoa: 'Fornecedor',
    pessoaPlural: 'Fornecedores',
    tipoPessoa: 'FORNECEDOR',
    classificacao: 'Tipos de despesa',
    classificacaoSingular: 'tipo de despesa',
    tipoClassificacao: 'DESPESA',
  },
  ARECEBER: {
    titulo: 'Contas a receber',
    subtitulo:
      'Valores a receber de clientes, classificados em um ou mais tipos de receita e divididos em uma ou mais parcelas.',
    singular: 'conta a receber',
    pessoa: 'Cliente',
    pessoaPlural: 'Clientes',
    tipoPessoa: 'CLIENTE',
    classificacao: 'Tipos de receita',
    classificacaoSingular: 'tipo de receita',
    tipoClassificacao: 'RECEITA',
  },
}

function nomeConta(conta: Conta): string {
  const nota = conta.numeroNotaFiscal ? `NF ${conta.numeroNotaFiscal}` : `Conta ID ${conta.idMovimentoContas}`
  return `${nota} — ${conta.fornecedorCliente.razaoSocial}`
}

interface Props {
  tipo: TipoMovimento
  /** Abre já buscando este termo (o nº da nota, vindo do lançamento). */
  buscaInicial?: string | null
  aoExpirarSessao: () => void
}

/** Registrar Contas: contas a pagar e a receber (T001_MOVIMENTOCONTAS + T002_PARCELACONTAS). */
export default function Contas({ tipo, buscaInicial, aoExpirarSessao }: Props) {
  const t = TEXTOS[tipo]
  const [editando, setEditando] = useState<Conta | 'nova' | null>(null)
  const [recarga, setRecarga] = useState<Recarga | null>(null)

  const colunas: Coluna<Conta>[] = [
    { titulo: 'ID', ordem: 'idMovimentoContas', valor: (c) => c.idMovimentoContas, classe: 'numero' },
    { titulo: 'Nº NF', ordem: 'numeroNotaFiscal', valor: (c) => c.numeroNotaFiscal ?? '—', classe: 'nowrap' },
    { titulo: 'Emissão', ordem: 'dataEmissao', valor: (c) => formatarData(c.dataEmissao), classe: 'nowrap' },
    {
      titulo: t.pessoa,
      ordem: 'fornecedorCliente',
      valor: (c) => (
        <>
          {c.fornecedorCliente.razaoSocial}
          <span className="celula-detalhe documento">{c.fornecedorCliente.documento}</span>
        </>
      ),
    },
    { titulo: 'Faturado', valor: (c) => c.faturado.razaoSocial },
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

  function aoSalvar(conta: Conta, nova: boolean) {
    setEditando(null)
    const singular = t.singular.charAt(0).toUpperCase() + t.singular.slice(1)
    setRecarga({
      mensagem: `${singular} ${nova ? 'registrada' : 'atualizada'}: ${nomeConta(conta)} (ID ${conta.idMovimentoContas}).`,
    })
  }

  return (
    <>
      <div hidden={editando !== null}>
        <Cabecalho titulo={t.titulo} subtitulo={t.subtitulo} />
        <Listagem<Conta>
          tituloBusca={`Buscar ${t.titulo.toLowerCase()}`}
          tituloLista={`Lista de ${t.titulo.toLowerCase()}`}
          rotulo={t.singular}
          placeholder={`Buscar por nº da nota, descrição ou ${t.pessoa.toLowerCase()}…`}
          colunas={colunas}
          ordemPadrao={{ ordem: 'dataEmissao', direcao: 'desc' }}
          listar={(consulta) => contas.listar({ ...consulta, tipo })}
          inativar={contas.inativar}
          reativar={contas.reativar}
          id={(c) => c.idMovimentoContas}
          nome={nomeConta}
          aoEditar={setEditando}
          aoInserir={() => setEditando('nova')}
          textoInserir={`Registrar nova ${t.singular}`}
          recarga={recarga}
          buscaInicial={buscaInicial}
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
          tipo={tipo}
          conta={editando === 'nova' ? null : editando}
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

interface Opcoes {
  pessoas: Pessoa[]
  faturados: Pessoa[]
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
  tipo: TipoMovimento
  conta: Conta | null
  aoSalvar: (conta: Conta, nova: boolean) => void
  aoVoltar: () => void
  aoExpirarSessao: () => void
}

function FormularioConta({ tipo, conta, aoSalvar, aoVoltar, aoExpirarSessao }: PropsFormulario) {
  const t = TEXTOS[tipo]
  const proximaChave = useRef(conta?.parcelas.length ?? 1)
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null)
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

  useEffect(() => {
    window.scrollTo({ top: 0 })
    Promise.all([
      pessoas.listar({ tipo: t.tipoPessoa }),
      pessoas.listar({ tipo: 'FATURADO' }),
      classificacoes.listar({ tipo: t.tipoClassificacao }),
    ])
      .then(([lista, faturados, tipos]) =>
        setOpcoes({
          pessoas: comAtual(lista, conta ? [conta.fornecedorCliente] : [], (p) => p.idPessoas),
          faturados: comAtual(faturados, conta ? [conta.faturado] : [], (p) => p.idPessoas),
          classificacoes: comAtual(tipos, conta?.classificacoes ?? [], (c) => c.idClassificacao),
        }),
      )
      .catch((e) => {
        if (e instanceof SessaoExpirada) return aoExpirarSessao()
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar os cadastros')
      })
  }, [])

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

  const bloqueado = salvando || opcoes === null

  return (
    <>
      <Cabecalho
        titulo={conta ? `Editar ${t.singular}` : `Nova ${t.singular}`}
        subtitulo={
          conta ? `ID ${conta.idMovimentoContas}${conta.status === 'INATIVO' ? ' · INATIVA' : ''}` : undefined
        }
        aoVoltar={aoVoltar}
      />

      <form className="painel" onSubmit={enviar}>
        <h2>Formulário de {t.singular}</h2>

        <div className="grade-formulario">
          <label className="campo campo-metade">
            <span className="campo-rotulo">{t.pessoa}</span>
            <SelecaoPessoa
              pessoas={opcoes?.pessoas}
              valor={idPessoa}
              aoAlterar={setIdPessoa}
              desabilitado={bloqueado}
              vazio={`Nenhum ${t.pessoa.toLowerCase()} ativo: cadastre em ${t.pessoaPlural}`}
            />
          </label>

          <label className="campo campo-metade">
            <span className="campo-rotulo">Faturado</span>
            <SelecaoPessoa
              pessoas={opcoes?.faturados}
              valor={idFaturado}
              aoAlterar={setIdFaturado}
              desabilitado={bloqueado}
              vazio="Nenhum faturado ativo: cadastre em Faturados"
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
                Nenhum {t.classificacaoSingular} ativo: cadastre em {t.classificacao}.
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
