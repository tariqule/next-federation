import {
  ISLAND_SHARE_NAMESPACE,
  ISLAND_SHARE_SCOPE,
} from '@next-federation/protocol'
import type { IslandShareScope } from '@next-federation/protocol'
import { version } from 'react'

/** The `from` of the entries `provideHostReact()` registers. */
export const HOST_PROVIDER = 'host'

type FederationGlobal = {
  __FEDERATION__?: {
    __SHARE__?: Record<string, Record<string, IslandShareScope> | undefined>
  }
}

/** The island share scope, if the page has one; never creates it. */
export function peekIslandShareScope(): IslandShareScope | undefined {
  const g = globalThis as FederationGlobal
  return g.__FEDERATION__?.__SHARE__?.[ISLAND_SHARE_NAMESPACE]?.[
    ISLAND_SHARE_SCOPE
  ]
}

/**
 * True once `provideHostReact()` put this host's React into the island share
 * scope: islands on the same React version then run on the host's React.
 */
export function isHostReactProvided(): boolean {
  return (
    peekIslandShareScope()?.['react-dom']?.[version]?.from === HOST_PROVIDER
  )
}
