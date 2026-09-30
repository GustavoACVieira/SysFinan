import { useState } from 'react'
import { extrairDados, SessaoExpirada } from './api'
// import Etapas from './Etapas'
import type { ResultadoExtracao } from './types'

interface Props {
  chaveInformada: boolean
  aoInformarChave: () => void
  aoVerCategorias: () => void
  aoExpirarSessao: () => void
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function Extracao({
  chaveInformada,
  aoInformarChave,
  aoVerCategorias,
  aoExpirarSessao,
}: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [resultado, setResultado] = useState<ResultadoExtracao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  function selecionarArquivo(event: React.ChangeEvent<HTMLInputElement>) {
    setArquivo(event.target.files?.[0] ?? null)
    setResultado(null)
    setErro(null)
  }

  async function solicitarExtracao() {
    if (!arquivo) return

    setCarregando(true)
    setErro(null)
    setResultado(null)

    try {
      setResultado(await extrairDados(arquivo))
    } catch (e) {
      if (e instanceof SessaoExpirada) return aoExpirarSessao()
      setErro(e instanceof Error ? e.message : 'Erro inesperado na extração')
    } finally {
      setCarregando(false)
    }
  }

  const dados = resultado?.dados ?? null
  const etapaReprovada = resultado?.etapas.find((e) => e.status === 'falhou')

  async function copiarJson() {
    if (!dados) return
    await navigator.clipboard.writeText(JSON.stringify(dados, null, 2))
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <>
      <section className="painel">
        <h2>Nota fiscal</h2>

        <div className="campo-arquivo">
          <input
            id="arquivo"
            className="entrada-arquivo"
            type="file"
            accept="application/pdf"
            onChange={selecionarArquivo}
            disabled={carregando}
          />
          <label htmlFor="arquivo" className="botao-secundario">
            {arquivo ? 'Trocar arquivo' : 'Escolher arquivo'}
          </label>

          {arquivo ? (
            <span className="arquivo">
              <span className="arquivo-nome">{arquivo.name}</span>
              <span className="arquivo-tamanho">{formatarTamanho(arquivo.size)}</span>
            </span>
          ) : (
            <span className="arquivo-vazio">Nenhum arquivo selecionado</span>
          )}
        </div>

        <button
          type="button"
          className="botao-primario botao-extrair"
          onClick={solicitarExtracao}
          disabled={!arquivo || carregando || !chaveInformada}
        >
          {carregando ? 'Extraindo…' : 'Extrair dados'}
        </button>

        {carregando && (
          <p className="dica">
            O agent executa as etapas em sequência e verifica cada uma antes de seguir. Isso pode
            levar alguns minutos.
          </p>
        )}
        {!chaveInformada && (
          <p className="dica">
            Para liberar a extração,{' '}
            <button type="button" className="botao-link" onClick={aoInformarChave}>
              informe a chave da API do Gemini
            </button>
            .
          </p>
        )}
        {erro && <p className="erro">{erro}</p>}
        {etapaReprovada && (
          <p className="erro">
            A extração parou na etapa “{etapaReprovada.titulo}”: {etapaReprovada.problemas.join(' ')}
          </p>
        )}
      </section>

      {/* Painel de etapas da extração, desativado.
      {resultado && (
        <section className="painel">
          <div className="painel-cabecalho">
            <h2>Etapas da extração</h2>
            <span className={`selo ${resultado.concluida ? 'selo-ativa' : 'selo-inativa'}`}>
              <span className="selo-ponto" aria-hidden="true" />
              {resultado.concluida ? 'Todas aprovadas' : 'Interrompida'}
            </span>
          </div>

          <Etapas etapas={resultado.etapas} />
        </section>
      )}
      */}

      {dados && (
        <section className="painel">
          <div className="painel-cabecalho">
            <h2>Dados extraídos</h2>
            <button type="button" className="botao-secundario" onClick={copiarJson}>
              {copiado ? 'Copiado' : 'Copiar JSON'}
            </button>
          </div>

          {resultado?.categoriaCriada && (
            <div className="categoria-criada">
              <p>
                O agent criou a categoria <strong>{resultado.categoriaCriada.nome}</strong>:{' '}
                {resultado.categoriaCriada.descricao}
              </p>
              <button type="button" className="botao-link" onClick={aoVerCategorias}>
                Ver categorias
              </button>
            </div>
          )}

          <pre className="json">{JSON.stringify(dados, null, 2)}</pre>
        </section>
      )}
    </>
  )
}
