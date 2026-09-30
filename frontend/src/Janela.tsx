import { useEffect, useId, useRef } from 'react'

interface Props {
  aberta: boolean
  aoFechar: () => void
  titulo: string
  aoAbrir?: () => void
  larga?: boolean
  /** Enquanto true, a janela não fecha (Esc, × e clique fora ficam sem efeito). */
  bloqueada?: boolean
  children: React.ReactNode
}

export default function Janela({
  aberta,
  aoFechar,
  titulo,
  aoAbrir,
  larga,
  bloqueada = false,
  children,
}: Props) {
  const janela = useRef<HTMLDialogElement>(null)
  const idTitulo = useId()

  useEffect(() => {
    const dialogo = janela.current
    if (!dialogo) return
    if (aberta && !dialogo.open) {
      dialogo.showModal()
      aoAbrir?.()
    } else if (!aberta && dialogo.open) {
      dialogo.close()
    }
  }, [aberta])

  function fechar() {
    if (!bloqueada) aoFechar()
  }

  return (
    <dialog
      ref={janela}
      className={larga ? 'janela janela-larga' : 'janela'}
      aria-labelledby={idTitulo}
      aria-busy={bloqueada}
      onCancel={(e) => bloqueada && e.preventDefault()}
      onClose={() => {
        // O Chrome fecha no segundo Esc mesmo com preventDefault; reabre se estiver bloqueada.
        if (bloqueada) janela.current?.showModal()
        else aoFechar()
      }}
      onClick={(e) => e.target === e.currentTarget && fechar()}
    >
      <div className="janela-conteudo">
        <div className="painel-cabecalho">
          <h2 id={idTitulo}>{titulo}</h2>
          <button
            type="button"
            className="botao-fechar"
            onClick={fechar}
            disabled={bloqueada}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
