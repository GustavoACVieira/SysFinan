import { useEffect, useState } from 'react'
import { analisarNota, classificacoes, lancarNota, pessoas, SessaoExpirada } from './api'
import { formatarData, formatarReais, tipoDocumento } from './formatos'
import type {
  Analise,
  Categoria,
  ConsultaDespesa,
  ConsultaPessoa,
  Lancamento,
  NotaFiscalExtraida,
} from './types'

interface Props {
  nota: NotaFiscalExtraida
  /** Categoria nova sugerida pelo agent (já está em nota.tiposDespesa). */
  categoriaSugerida: Categoria | null
  /** Abre Contas a pagar buscando a nota. */
  aoVerConta: (numeroNotaFiscal: string | null) => void
  aoExpirarSessao: () => void
}

/**
 * 2ª etapa: depois da extração, consulta no banco se o FORNECEDOR, o FATURADO e cada
 * DESPESA da nota existem e mostra a resposta. Ao lançar, o back-end cria o que não existe,
 * registra o movimento (APAGAR) e suas parcelas, tudo numa transação só.
 */
export default function AnaliseNota({ nota, categoriaSugerida, aoVerConta, aoExpirarSessao }: Props) {
  const [analise, setAnalise] = useState<Analise | null>(null)
  const [consultando, setConsultando] = useState(false)
  const [reativando, setReativando] = useState<string | null>(null)
  const [lancando, setLancando] = useState(false)
  const [lancamento, setLancamento] = useState<Lancamento | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  function tratarErro(e: unknown, padrao: string) {
    if (e instanceof SessaoExpirada) return aoExpirarSessao()
    setErro(e instanceof Error ? e.message : padrao)
  }

  async function consultar() {
    setConsultando(true)
    setErro(null)
    try {
      setAnalise(await analisarNota(nota))
    } catch (e) {
      tratarErro(e, 'Não foi possível consultar o banco')
    } finally {
      setConsultando(false)
    }
  }

  // Um componente por extração (key no Extracao): a análise começa assim que os dados chegam.
  useEffect(() => {
    consultar()
  }, [])

  async function reativar(chave: string, chamada: () => Promise<unknown>) {
    setReativando(chave)
    setErro(null)
    try {
      await chamada()
      await consultar()
    } catch (e) {
      tratarErro(e, 'Não foi possível reativar o cadastro')
    } finally {
      setReativando(null)
    }
  }

  async function lancar() {
    setLancando(true)
    setErro(null)
    try {
      setLancamento(await lancarNota(nota))
    } catch (e) {
      tratarErro(e, 'Não foi possível lançar o registro')
    } finally {
      setLancando(false)
    }
  }

  const consultas = analise ? [analise.fornecedor, analise.faturado, ...analise.despesas] : []
  const temInativo = consultas.some((c) => c.status === 'INATIVO')
  const jaLancada = analise?.contaJaLancada != null && !lancamento
  const podeLancar = analise !== null && !temInativo && !jaLancada && !lancamento
  const ocupado = consultando || lancando || reativando !== null

  return (
    <section className="painel">
      <div className="painel-cabecalho">
        <h2>Análise no banco de dados</h2>
        {analise && !lancamento && (
          <button type="button" className="botao-secundario" onClick={consultar} disabled={ocupado}>
            {consultando ? 'Consultando…' : 'Consultar de novo'}
          </button>
        )}
      </div>

      {!analise && consultando && (
        <p className="dica dica-topo">Consultando fornecedor, faturado e despesa no banco…</p>
      )}

      {analise && (
        <>
          <div className="analise" aria-busy={consultando}>
            <BlocoPessoa
              titulo="Fornecedor"
              consulta={analise.fornecedor}
              reativando={reativando === 'fornecedor'}
              desabilitado={ocupado || lancamento !== null}
              aoReativar={() => reativar('fornecedor', () => pessoas.reativar(analise.fornecedor.id!))}
            />
            <BlocoPessoa
              titulo="Faturado"
              consulta={analise.faturado}
              reativando={reativando === 'faturado'}
              desabilitado={ocupado || lancamento !== null}
              aoReativar={() => reativar('faturado', () => pessoas.reativar(analise.faturado.id!))}
            />
            <div className="analise-bloco">
              <h3 className="analise-titulo">Despesa</h3>
              {analise.despesas.map((d) => (
                <BlocoDespesa
                  key={d.descricao}
                  consulta={d}
                  sugestao={
                    categoriaSugerida && !d.existe && d.descricao === categoriaSugerida.nome
                      ? categoriaSugerida.descricao
                      : null
                  }
                  reativando={reativando === d.descricao}
                  desabilitado={ocupado || lancamento !== null}
                  aoReativar={() => reativar(d.descricao, () => classificacoes.reativar(d.id!))}
                />
              ))}
            </div>
          </div>

          {lancamento ? (
            <Sucesso lancamento={lancamento} analise={analise} aoVerConta={aoVerConta} />
          ) : (
            <>
              {!jaLancada && <Plano nota={nota} analise={analise} />}

              {jaLancada && (
                <div className="alerta">
                  <p>
                    Esta nota já foi lançada para este fornecedor (conta a pagar ID{' '}
                    {analise.contaJaLancada}). Lançar de novo pagaria a mesma nota em dobro.
                  </p>
                  <button
                    type="button"
                    className="botao-link"
                    onClick={() => aoVerConta(nota.numeroNotaFiscal)}
                  >
                    Ver em Contas a pagar
                  </button>
                </div>
              )}
              {temInativo && (
                <p className="alerta">
                  Há cadastro INATIVO nesta nota e ele não pode ser usado no lançamento. Reative-o
                  acima para continuar.
                </p>
              )}

              <button
                type="button"
                className="botao-primario botao-lancar"
                onClick={lancar}
                disabled={!podeLancar || ocupado}
              >
                {lancando ? 'Lançando…' : 'Lançar registro'}
              </button>
            </>
          )}
        </>
      )}

      {erro && <p className="erro">{erro}</p>}
    </section>
  )
}

interface PropsBloco {
  reativando: boolean
  desabilitado: boolean
  aoReativar: () => void
}

function BlocoPessoa({ titulo, consulta, ...situacao }: PropsBloco & { titulo: string; consulta: ConsultaPessoa }) {
  return (
    <div className="analise-bloco">
      <h3 className="analise-titulo">{titulo}</h3>
      <p className="analise-nome">{consulta.razaoSocial ?? 'Nome não informado na nota'}</p>
      <p className="analise-detalhe">
        {consulta.documento
          ? `${tipoDocumento(consulta.documento)}: ${consulta.documento}`
          : 'CPF/CNPJ não informado na nota'}
      </p>
      <Situacao consulta={consulta} seraCriado="Será cadastrado ao lançar." {...situacao} />
    </div>
  )
}

function BlocoDespesa({
  consulta,
  sugestao,
  ...situacao
}: PropsBloco & { consulta: ConsultaDespesa; sugestao: string | null }) {
  return (
    <div className="analise-item">
      <p className="analise-nome">{consulta.descricao}</p>
      {sugestao && <p className="analise-detalhe">Sugerida pelo agent: {sugestao.replace(/\.$/, '')}.</p>}
      <Situacao consulta={consulta} seraCriado="Será cadastrada ao lançar." {...situacao} />
    </div>
  )
}

function Situacao({
  consulta,
  seraCriado,
  reativando,
  desabilitado,
  aoReativar,
}: PropsBloco & { consulta: ConsultaPessoa | ConsultaDespesa; seraCriado: string }) {
  if (!consulta.existe) {
    return (
      <>
        <p className="analise-situacao analise-nao-existe">NÃO EXISTE</p>
        <p className="analise-detalhe">{seraCriado}</p>
      </>
    )
  }
  return (
    <>
      <p className="analise-situacao analise-existe">EXISTE – ID: {consulta.id}</p>
      {consulta.status === 'INATIVO' && (
        <div className="analise-inativo">
          <span>Cadastro INATIVO</span>
          <button type="button" className="botao-pequeno" onClick={aoReativar} disabled={desabilitado}>
            {reativando ? 'Reativando…' : 'Reativar'}
          </button>
        </div>
      )}
    </>
  )
}

function descreverParcelas(nota: NotaFiscalExtraida): string {
  const parcelas = nota.parcelas
  if (parcelas.length === 1) {
    return `a parcela ÚNICA, com vencimento em ${formatarData(parcelas[0].dataVencimento)}`
  }
  return (
    `${parcelas.length} parcelas, com vencimentos em ` +
    parcelas.map((p) => formatarData(p.dataVencimento)).join(', ')
  )
}

/** O que o lançamento vai fazer, na ordem do enunciado. */
function Plano({ nota, analise }: { nota: NotaFiscalExtraida; analise: Analise }) {
  const { fornecedor, faturado, despesas } = analise
  const nf = nota.numeroNotaFiscal ? `NF ${nota.numeroNotaFiscal}, ` : ''

  return (
    <div className="analise-plano">
      <h3 className="analise-titulo">Ao lançar, o sistema vai</h3>
      <ol>
        <li>
          {fornecedor.existe
            ? `Usar o fornecedor já cadastrado (ID ${fornecedor.id}).`
            : `Cadastrar o novo fornecedor ${fornecedor.razaoSocial ?? ''}.`}
        </li>
        <li>
          {faturado.existe
            ? `Usar o faturado já cadastrado (ID ${faturado.id}).`
            : `Cadastrar o novo faturado ${faturado.razaoSocial ?? ''}.`}
        </li>
        <li>
          {despesas
            .map((d) =>
              d.existe
                ? `Usar a despesa ${d.descricao} (ID ${d.id})`
                : `Cadastrar a nova despesa ${d.descricao}`,
            )
            .join('; ')}
          .
        </li>
        <li>
          Registrar a conta a pagar ({nf}
          {formatarReais(nota.valorTotal)}) com {descreverParcelas(nota)}.
        </li>
      </ol>
    </div>
  )
}

function Sucesso({
  lancamento,
  analise,
  aoVerConta,
}: {
  lancamento: Lancamento
  analise: Analise
  aoVerConta: (numeroNotaFiscal: string | null) => void
}) {
  const { conta } = lancamento
  const despesasExistentes = new Set(analise.despesas.filter((d) => d.existe).map((d) => d.id))

  return (
    <div className="lancamento-sucesso" role="status">
      <p className="lancamento-titulo">✓ {lancamento.mensagem}</p>
      <dl className="lancamento-resumo">
        <dt>Conta a pagar</dt>
        <dd>
          ID {conta.idMovimentoContas}
          {conta.numeroNotaFiscal && ` · NF ${conta.numeroNotaFiscal}`} · {formatarReais(conta.valorTotal)}
        </dd>
        <dt>Fornecedor</dt>
        <dd>
          {conta.fornecedorCliente.razaoSocial} · ID {conta.fornecedorCliente.idPessoas}
          {!analise.fornecedor.existe && <span className="novo">cadastrado agora</span>}
        </dd>
        <dt>Faturado</dt>
        <dd>
          {conta.faturado.razaoSocial} · ID {conta.faturado.idPessoas}
          {!analise.faturado.existe && <span className="novo">cadastrado agora</span>}
        </dd>
        <dt>{conta.classificacoes.length > 1 ? 'Despesas' : 'Despesa'}</dt>
        <dd>
          {conta.classificacoes.map((c) => (
            <span key={c.idClassificacao} className="lancamento-linha">
              {c.descricao} · ID {c.idClassificacao}
              {!despesasExistentes.has(c.idClassificacao) && <span className="novo">cadastrada agora</span>}
            </span>
          ))}
        </dd>
        <dt>{conta.parcelas.length > 1 ? 'Parcelas' : 'Parcela'}</dt>
        <dd>
          {conta.parcelas.map((p) => (
            <span key={p.idParcelaContas} className="lancamento-linha">
              {p.identificacao} · vence em {formatarData(p.dataVencimento)} · {formatarReais(p.valorParcela)}
            </span>
          ))}
        </dd>
      </dl>
      <button type="button" className="botao-secundario" onClick={() => aoVerConta(conta.numeroNotaFiscal)}>
        Ver em Contas a pagar
      </button>
    </div>
  )
}
