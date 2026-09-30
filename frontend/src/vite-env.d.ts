/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Commit do build do front (definido no vite.config.ts). */
declare const __VERSAO__: { commit: string; alterado: boolean }
