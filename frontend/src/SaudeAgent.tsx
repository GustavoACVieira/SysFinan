import { useState } from 'react'
import { SessaoExpirada, verificarAgent } from './api'
import type { SaudeAgent as Saude } from './types'

interface Props {
  chaveInformada: boolean
  aoExpirarSessao: () => void
}

const ROTULO: Record<Saude['status'], string> = {
  operacional: 'Operacional',
  degradado: 'Degradado',
  inoperante: 'Inoperante',
}

const CLASSE_SELO: Record<Saude['status'], string> = {
  operacional: 'selo-ativa',
  degradado: 'selo-alerta',
  inoperante: 'selo-inativa',
}

/** Painel que verifica, sob demanda, se o Agent1 está funcionando. */
export default function SaudeAgent({ chaveInformada, aoExpirarSessao }: Props) {
  const [saude, setSaude] = useState<Saude | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)

  async function verificar() {
    setVerificando(true)
    setErro(null)
    try {
      setSaude(await verificarAgent())
    } catch (e) {
      if (e instanceof SessaoExpirada) return aoExpirarSessao()
      setErro(e instanceof Error ? e.message : 'Erro inesperado ao verificar o agent')
    } finally {
      setVerificando(false)
    }
  }

  return (
    <section className="painel">
      <div className="painel-cabecalho">
        <h2>Funcionamento do agent</h2>
        {saude && (
          <span className={`selo ${CLASSE_SELO[saude.status]}`}>
            <span className="selo-ponto" aria-hidden="true" />
            {ROTULO[saude.status]}
          </span>
        )}
      </div>

      {saude ? (
        <>
          <p className="saude-mensagem">{saude.mensagem}</p>

          {saude.modelos.length > 0 && (
            <ul className="saude-lista">
              {saude.modelos.map((m, i) => (
                <li key={m.modelo}>
                  <span className={m.disponivel ? 'ok' : 'falha'} aria-hidden="true">
                    {m.disponivel ? '✓' : '✕'}
                  </span>
                  <span className="saude-nome">{m.modelo}</span>
                  <span className="saude-detalhe">
                    {i === 0 ? 'preferido' : 'reserva'}
                    {m.latenciaMs !== null && ` · ${m.latenciaMs} ms`}
                    {m.erro && ` · ${m.erro}`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {saude.testeGeracao && (
            <p className="dica">
              Teste de geração estruturada:{' '}
              {saude.testeGeracao.sucesso
                ? `ok com ${saude.testeGeracao.modelo} em ${saude.testeGeracao.latenciaMs} ms.`
                : `falhou — ${saude.testeGeracao.erro}`}
            </p>
          )}
          <p className="dica">
            Verificado em {new Date(saude.verificadoEm).toLocaleString('pt-BR')}.
          </p>
        </>
      ) : (
        <p className="saude-mensagem">
          Confere a chave, a disponibilidade de cada modelo e faz uma chamada real ao Gemini.
        </p>
      )}

      <button
        type="button"
        className="botao-secundario botao-extrair"
        onClick={verificar}
        disabled={verificando || !chaveInformada}
      >
        {verificando ? 'Verificando…' : saude ? 'Verificar novamente' : 'Verificar agora'}
      </button>

      {erro && <p className="erro">{erro}</p>}
    </section>
  )
}
