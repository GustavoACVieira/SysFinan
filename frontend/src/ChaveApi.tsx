import { useEffect, useRef, useState } from 'react'
import { removerChave, salvarChave, SessaoExpirada } from './api'
import type { StatusChaveApi } from './types'

interface Props {
  aberta: boolean
  aoFechar: () => void
  /** null enquanto a situação da chave ainda está sendo consultada. */
  status: StatusChaveApi | null
  aoAlterar: (status: StatusChaveApi) => void
  aoExpirarSessao: () => void
}

/** Janela para informar, substituir ou remover a chave da API do Gemini. */
export default function ChaveApi({ aberta, aoFechar, status, aoAlterar, aoExpirarSessao }: Props) {
  const janela = useRef<HTMLDialogElement>(null)
  const campo = useRef<HTMLInputElement>(null)
  const [chave, setChave] = useState('')
  const [visivel, setVisivel] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const dialogo = janela.current
    if (!dialogo) return
    if (aberta && !dialogo.open) {
      setChave('')
      setVisivel(false)
      setErro(null)
      dialogo.showModal()
      // O showModal foca o primeiro botão (o ×); o que interessa é o campo da chave.
      campo.current?.focus()
    } else if (!aberta && dialogo.open) {
      dialogo.close()
    }
  }, [aberta])

  async function executar(acao: () => Promise<StatusChaveApi>, fecharAoConcluir: boolean) {
    setSalvando(true)
    setErro(null)
    try {
      aoAlterar(await acao())
      setChave('')
      if (fecharAoConcluir) aoFechar()
    } catch (e) {
      if (e instanceof SessaoExpirada) return aoExpirarSessao()
      setErro(e instanceof Error ? e.message : 'Erro inesperado ao salvar a chave')
    } finally {
      setSalvando(false)
    }
  }

  function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    executar(() => salvarChave(chave.trim()), true)
  }

  return (
    <dialog
      ref={janela}
      className="janela"
      aria-labelledby="titulo-chave"
      onClose={aoFechar}
      // Clique no fundo escurecido (fora do conteúdo) fecha a janela.
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
    >
      <div className="janela-conteudo">
        <div className="painel-cabecalho">
          <h2 id="titulo-chave">Chave da API do Gemini</h2>
          <button type="button" className="botao-fechar" onClick={aoFechar} aria-label="Fechar">
            ×
          </button>
        </div>

        <p className="janela-status">
          Situação: <SeloStatus status={status} />
        </p>

        <form className="linha-chave" onSubmit={enviar}>
          <div className="entrada-com-acao">
            <input
              className="entrada"
              type={visivel ? 'text' : 'password'}
              placeholder={status?.informada ? 'Nova chave (substitui a atual)' : 'Cole aqui a chave da API'}
              autoComplete="off"
              spellCheck={false}
              ref={campo}
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
              onClick={() => executar(removerChave, false)}
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
      </div>
    </dialog>
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
