interface Props {
  titulo: string
  subtitulo?: React.ReactNode
  /** Botão à direita do título, ex.: "← Voltar" no formulário. */
  aoVoltar?: () => void
}

export default function Cabecalho({ titulo, subtitulo, aoVoltar }: Props) {
  return (
    <div className="cabecalho-pagina">
      <div>
        <h1 className="titulo-pagina">{titulo}</h1>
        {subtitulo && <p className="subtitulo">{subtitulo}</p>}
      </div>
      {aoVoltar && (
        <button type="button" className="botao-secundario" onClick={aoVoltar}>
          ← Voltar
        </button>
      )}
    </div>
  )
}
