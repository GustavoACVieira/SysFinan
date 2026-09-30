import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function git(comando: string): string {
  try {
    return execSync(`git ${comando}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

// No Render o commit do deploy vem em RENDER_GIT_COMMIT; localmente, do git.
const commit = (process.env.RENDER_GIT_COMMIT || git('rev-parse HEAD')).slice(0, 7)
const alterado = !process.env.RENDER_GIT_COMMIT && git('status --porcelain') !== ''

export default defineConfig({
  plugins: [react()],
  define: {
    __VERSAO__: JSON.stringify({ commit, alterado }),
  },
  server: {
    // '::' abre socket dual-stack: atende tanto 127.0.0.1 quanto [::1].
    // Sem isso o Vite escuta so em IPv6 e o navegador recusa conexao em 127.0.0.1.
    host: '::',
    port: 5173,
  },
})
