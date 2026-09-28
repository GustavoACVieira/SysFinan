import { useState } from 'react'
import { entrar } from './api'

interface Props {
  aoEntrar: () => void
}

export default function Login({ aoEntrar }: Props) {
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCarregando(true)
    setErro(null)

    try {
      await entrar(usuario.trim(), senha)
      aoEntrar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado no login')
      setCarregando(false)
    }
  }

  return (
    <main className="pagina pagina-login">
      <h1>Entrar</h1>
      <p className="subtitulo">Acesse com o usuário administrador do SysFinan.</p>

      <form className="painel" onSubmit={enviar}>
        <label className="campo">
          <span className="campo-rotulo">Usuário</span>
          <input
            className="entrada"
            type="text"
            autoComplete="username"
            autoFocus
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            disabled={carregando}
            required
          />
        </label>

        <label className="campo">
          <span className="campo-rotulo">Senha</span>
          <input
            className="entrada"
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            disabled={carregando}
            required
          />
        </label>

        <button
          type="submit"
          className="botao-primario botao-largo"
          disabled={carregando || !usuario.trim() || !senha}
        >
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>

        {erro && <p className="erro">{erro}</p>}
      </form>
    </main>
  )
}
