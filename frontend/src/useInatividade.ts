import { useEffect, useRef, useState } from 'react'
import {
  RENOVAR_A_CADA,
  registrarAtividade,
  renovarSessao,
  SessaoExpirada,
  tempoInatividade,
  ultimaAtividade,
} from './api'

const EVENTOS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
const AVISO_ANTES = 60_000 // ms
const GRAVAR_A_CADA = 5_000 // limita as escritas no localStorage durante o movimento do mouse

/**
 * Logout por inatividade. Enquanto o usuário mexe na tela, grava a última atividade
 * (compartilhada entre as abas) e renova a sessão no back-end; parado, avisa no último
 * minuto e chama `aoEsgotar` quando o tempo acaba.
 *
 * Devolve os segundos que faltam durante o aviso, ou null fora dele.
 */
export function useInatividade(
  ativo: boolean,
  aoEsgotar: () => void,
  aoExpirarSessao: () => void,
): number | null {
  const [restante, setRestante] = useState<number | null>(null)
  const esgotar = useRef(aoEsgotar)
  const expirar = useRef(aoExpirarSessao)
  esgotar.current = aoEsgotar
  expirar.current = aoExpirarSessao

  useEffect(() => {
    if (!ativo) {
      setRestante(null)
      return
    }

    let ultimaGravacao = 0
    let ultimaRenovacao = Date.now()

    function aoMexer() {
      const agora = Date.now()
      // Tempo já esgotado: mexer não reabre a sessão (o próximo tique a encerra).
      if (agora - ultimaAtividade() > tempoInatividade()) return
      if (agora - ultimaGravacao < GRAVAR_A_CADA) return
      ultimaGravacao = agora
      registrarAtividade()

      if (agora - ultimaRenovacao >= RENOVAR_A_CADA) {
        ultimaRenovacao = agora
        renovarSessao().catch((e) => {
          if (e instanceof SessaoExpirada) expirar.current()
        })
      }
    }

    function conferir() {
      const sobra = tempoInatividade() - (Date.now() - ultimaAtividade())
      if (sobra <= 0) return esgotar.current()
      setRestante(sobra <= AVISO_ANTES ? Math.ceil(sobra / 1000) : null)
    }

    for (const evento of EVENTOS) {
      window.addEventListener(evento, aoMexer, { passive: true, capture: true })
    }
    conferir()
    const relogio = window.setInterval(conferir, 1000)

    return () => {
      for (const evento of EVENTOS) {
        window.removeEventListener(evento, aoMexer, { capture: true })
      }
      window.clearInterval(relogio)
    }
  }, [ativo])

  return restante
}
