import { useEffect, useId, useRef } from 'react'

interface Props {
  aberta: boolean
  aoFechar: () => void
  titulo: string
  /** Chamado logo depois de abrir (ex.: limpar o formulário e focar um campo). */
  aoAbrir?: () => void
  larga?: boolean
  children: React.ReactNode
}

/** Janela modal com o <dialog> nativo: fecha com Esc, com o × ou clicando fora. */
export default function Janela({ aberta, aoFechar, titulo, aoAbrir, larga, children }: Props) {
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
    // aoAbrir fica de fora de propósito: só interessa no momento em que a janela abre.
  }, [aberta])

  return (
    <dialog
      ref={janela}
      className={larga ? 'janela janela-larga' : 'janela'}
      aria-labelledby={idTitulo}
      onClose={aoFechar}
      // Clique no fundo escurecido (fora do conteúdo) fecha a janela.
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
    >
      <div className="janela-conteudo">
        <div className="painel-cabecalho">
          <h2 id={idTitulo}>{titulo}</h2>
          <button type="button" className="botao-fechar" onClick={aoFechar} aria-label="Fechar">
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
