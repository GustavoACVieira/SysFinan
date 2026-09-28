import type { StatusEtapa, VerificacaoEtapa } from './types'

const ROTULO: Record<StatusEtapa, string> = {
  concluida: 'Concluída',
  falhou: 'Reprovada',
  nao_executada: 'Não executada',
}

function formatarDuracao(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** Relatório das etapas do Agent1, na ordem em que foram executadas. */
export default function Etapas({ etapas }: { etapas: VerificacaoEtapa[] }) {
  return (
    <ol className="etapas">
      {etapas.map((etapa, indice) => (
        <li key={etapa.etapa} className={`etapa etapa-${etapa.status}`}>
          <span className="etapa-marcador" aria-hidden="true">
            {etapa.status === 'concluida' ? '✓' : etapa.status === 'falhou' ? '✕' : indice + 1}
          </span>

          <div className="etapa-corpo">
            <div className="etapa-linha">
              <span className="etapa-titulo">{etapa.titulo}</span>
              <span className="etapa-status">{ROTULO[etapa.status]}</span>
            </div>

            {etapa.status !== 'nao_executada' && (
              <p className="etapa-meta">
                {etapa.tentativas} {etapa.tentativas === 1 ? 'tentativa' : 'tentativas'}
                {etapa.modelo && ` · ${etapa.modelo}`} · {formatarDuracao(etapa.duracaoMs)}
              </p>
            )}

            {etapa.problemas.length > 0 && (
              <ul className="etapa-problemas">
                {etapa.problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {etapa.avisos.length > 0 && (
              <ul className="etapa-avisos">
                {etapa.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
