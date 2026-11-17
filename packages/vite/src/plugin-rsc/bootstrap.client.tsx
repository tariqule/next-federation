// The island bootstrap of the remote's `client` build: `mountIsland`, built
// on this build's flight client and client references. `entry.client.tsx`
// exports it; with React sharing on it is imported only once the island
// share scope is ready (see ../share.ts).
import { createIslandBootstrap } from '@next-federation/island/bootstrap'
import { NFError } from '@next-federation/sdk'
import type { IslandBootstrapModule } from '@next-federation/protocol'
import {
  createFromReadableStream,
  encodeReply,
} from 'react-server-dom-webpack/client.browser'
import config from 'virtual:next-federation/config'
import clientReferences from 'virtual:vite-rsc/client-references'

function loadClientReference(id: string): Promise<unknown> {
  if (import.meta.env.__vite_rsc_build__) {
    const load = clientReferences[id]
    return load
      ? load()
      : Promise.reject(
          new NFError('NF-012', `Unknown client reference "${id}".`)
        )
  }
  // Dev: ids are server paths ('/src/x.tsx', '/@fs/...') under the base.
  return import(/* @vite-ignore */ new URL(id.slice(1), config.publicBase).href)
}

const bootstrap: IslandBootstrapModule = createIslandBootstrap({
  scopeKey: config.publicBase,
  remote: config.name,
  buildId: config.buildId,
  mode: import.meta.env.DEV ? 'development' : 'production',
  loadClientReference,
  createFromReadableStream,
  encodeReply,
})

export const mountIsland: IslandBootstrapModule['mountIsland'] =
  bootstrap.mountIsland
