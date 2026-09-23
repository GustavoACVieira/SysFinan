import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // '::' abre socket dual-stack: atende tanto 127.0.0.1 quanto [::1].
    // Sem isso o Vite escuta so em IPv6 e o navegador recusa conexao em 127.0.0.1.
    host: '::',
    port: 5173,
  },
})
