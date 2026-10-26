import Janela from './Janela'

interface Props {
  aberta: boolean
  titulo: string
  textoConfirmar: string
  /** Enquanto a ação roda, a janela não fecha e os botões ficam travados. */
  ocupada: boolean
  aoConfirmar: () => void
  aoCancelar: () => void
  children: React.ReactNode
}

export default function Confirmacao({
  aberta,
  titulo,
  textoConfirmar,
  ocupada,
  aoConfirmar,
  aoCancelar,
  children,
}: Props) {
  return (
    <Janela aberta={aberta} aoFechar={aoCancelar} titulo={titulo} bloqueada={ocupada}>
      <div className="confirmacao-texto">{children}</div>
      <div className="acoes-formulario">
        <button type="button" className="botao-perigo" onClick={aoConfirmar} disabled={ocupada}>
          {ocupada ? 'Aguarde…' : textoConfirmar}
        </button>
        <button type="button" className="botao-secundario" onClick={aoCancelar} disabled={ocupada}>
          Cancelar
        </button>
      </div>
    </Janela>
  )
}
