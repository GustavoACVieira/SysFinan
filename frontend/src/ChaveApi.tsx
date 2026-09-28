import { useState } from 'react'
import { removerChave, salvarChave, SessaoExpirada } from './api'
import type { StatusChaveApi } from './types'

interface Props {
  /** null enquanto a situação da chave ainda está sendo consultada. */
  status: StatusChaveApi | null
  aoAlterar: (status: StatusChaveApi) => void
  aoExpirarSessao: () => void
}

export default function ChaveApi({ status, aoAlterar, aoExpirarSessao }: Props) {
  const [chave, setChave] = useState('')
  const [visivel, setVisivel] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function executar(acao: () => Promise<StatusChaveApi>) {
    setSalvando(true)
    setErro(null)
    try {
      aoAlterar(await acao())
      setChave('')
    } catch (e) {
      if (e instanceof SessaoExpirada) return aoExpirarSessao()
      setErro(e instanceof Error ? e.message : 'Erro inesperado ao salvar a chave')
    } finally {
      setSalvando(false)
    }
  }

  function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    executar(() => salvarChave(chave.trim()))
  }

  return (
    <section className="painel">
      <div className="painel-cabecalho">
        <h2>Chave da API do Gemini</h2>
        <SeloStatus status={status} />
      </div>

      <form className="linha-chave" onSubmit={enviar}>
        <div className="entrada-com-acao">
          <input
            className="entrada"
            type={visivel ? 'text' : 'password'}
            placeholder={status?.informada ? 'Informe uma nova chave para substituir' : 'Cole aqui a chave da API'}
            autoComplete="off"
            spellCheck={false}
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            disabled={salvando}
            aria-label="Chave da API do Gemini"
          />
          <button
            type="button"
            className="botao-texto"
            onClick={() => setVisivel(!visivel)}
            aria-label={visivel ? 'Ocultar chave' : 'Mostrar chave'}
          >
            {visivel ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>

        <button type="submit" className="botao-primario" disabled={salvando || !chave.trim()}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        {status?.informada && (
          <button
            type="button"
            className="botao-secundario"
            onClick={() => executar(removerChave)}
            disabled={salvando}
          >
            Remover
          </button>
        )}
      </form>

      <p className="dica">
        Gere a chave em{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          aistudio.google.com/apikey
        </a>
        . Ela fica salva no servidor, em <code>backend/.env</code>.
      </p>

      {erro && <p className="erro">{erro}</p>}
    </section>
  )
}

function SeloStatus({ status }: { status: StatusChaveApi | null }) {
  if (!status) return <span className="selo">Verificando…</span>

  return status.informada ? (
    <span className="selo selo-ativa">
      <span className="selo-ponto" aria-hidden="true" />
      Ativa · {status.mascara}
    </span>
  ) : (
    <span className="selo selo-inativa">
      <span className="selo-ponto" aria-hidden="true" />
      Não informada
    </span>
  )
}
