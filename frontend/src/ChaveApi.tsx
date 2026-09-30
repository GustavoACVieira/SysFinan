import { useRef, useState } from 'react'
import { removerChave, salvarChave, SessaoExpirada } from './api'
import Janela from './Janela'
import type { StatusChaveApi } from './types'

interface Props {
  aberta: boolean
  aoFechar: () => void
  status: StatusChaveApi | null
  aoAlterar: (status: StatusChaveApi) => void
  aoExpirarSessao: () => void
}

type Acao = 'verificando' | 'removendo'
type Resultado = { tipo: 'sucesso' | 'falha'; texto: string }

function formatarHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function ChaveApi({ aberta, aoFechar, status, aoAlterar, aoExpirarSessao }: Props) {
  const campo = useRef<HTMLInputElement>(null)
  const [chave, setChave] = useState('')
  const [visivel, setVisivel] = useState(false)
  const [acao, setAcao] = useState<Acao | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  function aoAbrir() {
    setChave('')
    setVisivel(false)
    setResultado(null)
    // O showModal foca o ×; o foco vai para o campo.
    campo.current?.focus()
  }

  async function executar(tipo: Acao, chamada: () => Promise<StatusChaveApi>, sucesso: string) {
    setAcao(tipo)
    setResultado(null)
    try {
      aoAlterar(await chamada())
      setChave('')
      setResultado({ tipo: 'sucesso', texto: sucesso })
    } catch (e) {
      if (e instanceof SessaoExpirada) return aoExpirarSessao()
      setResultado({
        tipo: 'falha',
        texto: e instanceof Error ? e.message : 'Erro inesperado ao salvar a chave',
      })
    } finally {
      setAcao(null)
    }
  }

  function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    executar('verificando', () => salvarChave(chave.trim()), 'Chave verificada com o Google e ativada.')
  }

  const ocupada = acao !== null

  return (
    <Janela
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Chave da API do Gemini"
      aoAbrir={aoAbrir}
      bloqueada={ocupada}
    >
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
            disabled={ocupada}
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

        <button type="submit" className="botao-primario" disabled={ocupada || !chave.trim()}>
          {acao === 'verificando' ? 'Verificando…' : 'Salvar'}
        </button>
        {status?.informada && (
          <button
            type="button"
            className="botao-secundario"
            onClick={() => executar('removendo', removerChave, 'Chave removida.')}
            disabled={ocupada}
          >
            {acao === 'removendo' ? 'Removendo…' : 'Remover'}
          </button>
        )}
      </form>

      <div aria-live="polite">
        {acao === 'verificando' && (
          <p className="dica">Verificando a chave com o Google. Aguarde o resultado…</p>
        )}
        {resultado && (
          <p className={resultado.tipo === 'sucesso' ? 'mensagem-sucesso' : 'erro'}>
            {resultado.texto}
          </p>
        )}
      </div>
    </Janela>
  )
}

function SeloStatus({ status }: { status: StatusChaveApi | null }) {
  if (!status) return <span className="selo">Verificando…</span>

  return status.informada ? (
    <span className="selo selo-ativa">
      <span className="selo-ponto" aria-hidden="true" />
      Ativa · {status.mascara}
      {status.verificadaEm && ` · verificada às ${formatarHora(status.verificadaEm)}`}
    </span>
  ) : (
    <span className="selo selo-inativa">
      <span className="selo-ponto" aria-hidden="true" />
      Não informada
    </span>
  )
}
