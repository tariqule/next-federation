'use client'

import { createContext, useContext } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { IslandBridge } from '@next-federation/protocol'

// Used when no host provides a bridge (island rendered standalone): plain
// browser navigation.
const fallbackBridge: IslandBridge = {
  navigate: (href) => location.assign(href),
  prefetch: () => {},
  basePath: '',
  locale: '',
}

const BridgeContext = createContext<IslandBridge>(fallbackBridge)

/** The host navigation bridge of the island this component renders in. */
export function useIslandBridge(): IslandBridge {
  return useContext(BridgeContext)
}

export function BridgeProvider(props: {
  value: IslandBridge
  children: ReactNode
}): ReactElement {
  return (
    <BridgeContext.Provider value={props.value}>
      {props.children}
    </BridgeContext.Provider>
  )
}
