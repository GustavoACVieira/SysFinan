import { useState } from 'react'
import { extrairDados } from './api'
import type { NotaFiscalExtraida } from './types'

function formatarTamanho(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function App() {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [dados, setDados] = useState<NotaFiscalExtraida | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  function selecionarArquivo(event: React.ChangeEvent<HTMLInputElement>) {
    setArquivo(event.target.files?.[0] ?? null)
    setDados(null)
    setErro(null)
  }

  async function solicitarExtracao() {
    if (!arquivo) return

    setCarregando(true)
    setErro(null)
    setDados(null)

    try {
      setDados(await extrairDados(arquivo))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado na extração')
    } finally {
      setCarregando(false)
    }
  }

  async function copiarJson() {
    if (!dados) return
    await navigator.clipboard.writeText(JSON.stringify(dados, null, 2))
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <main className="pagina">
      <header className="cabecalho">
        <h1>Extração de Dados de Nota Fiscal</h1>
        <p>Carregue um PDF de nota fiscal e extraia os dados automaticamente usando IA</p>
      </header>

      <section className="cartao">
        <h2 className="cartao-titulo">Upload do PDF</h2>

        <label className="rotulo" htmlFor="arquivo">
          Selecione o arquivo PDF da nota fiscal
        </label>
        <input
          id="arquivo"
          type="file"
          accept="application/pdf"
          onChange={selecionarArquivo}
          disabled={carregando}
        />

        {arquivo && (
          <div className="arquivo-selecionado">
            <span className="arquivo-nome">{arquivo.name}</span>
            <span className="arquivo-tamanho">{formatarTamanho(arquivo.size)}</span>
          </div>
        )}

        <button
          type="button"
          className="botao-extrair"
          onClick={solicitarExtracao}
          disabled={!arquivo || carregando}
        >
          {carregando ? 'EXTRAINDO...' : 'EXTRAIR DADOS'}
        </button>

        {erro && <p className="erro">{erro}</p>}
      </section>

      {dados && (
        <section className="cartao">
          <div className="cartao-cabecalho">
            <h2 className="cartao-titulo">Dados em JSON</h2>
            <button type="button" className="botao-copiar" onClick={copiarJson}>
              {copiado ? 'Copiado!' : 'Copiar JSON'}
            </button>
          </div>

          <pre className="json">{JSON.stringify(dados, null, 2)}</pre>

          <p className="rodape-json">
            Este JSON contém os dados extraídos da nota fiscal e pode ser usado para integração
            com outros sistemas.
          </p>
        </section>
      )}
    </main>
  )
}
