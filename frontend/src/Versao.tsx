import { useEffect, useState } from 'react'
import { obterVersaoApi, type VersaoApi } from './api'

const FRONT = __VERSAO__

function Commit({ commit, alterado }: { commit: string; alterado: boolean }) {
  return (
    <code title={alterado ? 'Com alterações locais ainda não commitadas' : undefined}>
      {commit}
      {alterado && '*'}
    </code>
  )
}

/** Commit do front e da API em execução, para saber se o ambiente está atualizado. */
export default function Versao() {
  const [api, setApi] = useState<VersaoApi | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    obterVersaoApi()
      .then(setApi)
      .catch(() => setFalhou(true))
  }, [])

  const front = { commit: FRONT.commit || 'desconhecida', alterado: FRONT.alterado }
  const iguais = api && api.commit === front.commit && api.alterado === front.alterado

  if (iguais) {
    return (
      <p className="versao">
        Versão <Commit {...front} />
      </p>
    )
  }

  return (
    <p className={api ? 'versao versao-diferente' : 'versao'}>
      Front <Commit {...front} /> · API{' '}
      {api ? <Commit {...api} /> : falhou ? 'indisponível' : '…'}
      {api && <span className="versao-aviso">versões diferentes</span>}
    </p>
  )
}
