import { useState } from 'react'
import { entrar } from './api'
import Marca from './Marca'
import Versao from './Versao'

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
      <div className="login-marca">
        <Marca tamanho={84} />
        <h1 className="login-nome">
          <span className="marca-sys">SYS</span>
          <span className="marca-finan">FINAN</span>
        </h1>
        <p className="login-slogan">Sistema de Controle Financeiro</p>
      </div>

      <form className="painel" onSubmit={enviar}>
        <h2>Entrar</h2>
        <p className="subtitulo login-instrucao">Acesse com o usuário administrador.</p>

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

        <Versao />
      </form>
    </main>
  )
}
