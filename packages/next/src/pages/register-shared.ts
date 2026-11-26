// Registers the host's own `next/link` and `next/router` (guarded, at the
// host's Next version) and `@next-federation/router` backed by the Pages
// Router as shared modules, for every remote. Called at module scope by
// `./components.tsx` and `./server.ts` (a call, not a bare side-effect import,
// which a bundler may drop from a module it counts as pure): server code that
// imports only `@next-federation/next/pages/server` must not see a false
// NF-036 refusal from a preload. Calling it again is a no-op.
// `next/navigation` is not provided here: a remote that imports it renders
// its fallback (NF-036).
// Mixed hosts: this lands only in the runtime of the layer that imports it.
// Next bundles each layer (Pages server, App Router SSR, RSC) as its own
// module graph, so each gets its own copy of
// `@next-federation/react/components` and its own runtime; withFederation
// keeps next-federation packages out of `serverExternalPackages` (NF-002),
// so no layer shares a Node-required copy. Importing this entry from an App
// Router module would register the Pages router there: import it from Pages
// code only.
import * as base from '@next-federation/react/components'
import * as NextLink from 'next/link'
import * as NextRouter from 'next/router'
import { ROUTER_SHARE_NAME, ROUTER_VERSION } from '@next-federation/router'
import {
  guardNextLink,
  guardNextRouter,
} from '@next-federation/router/next-host'
import { hostNextVersion } from '../client/next-version.ts'
import { nextPagesRouterModule } from './router-module.tsx'

let registered = false

/** Registers the modules once; later calls do nothing. */
export function registerPagesShared(): void {
  if (registered) return
  registered = true
  const version = hostNextVersion()
  base.registerSharedModules({
    'next/link': { version, module: guardNextLink(NextLink) },
    'next/router': { version, module: guardNextRouter(NextRouter) },
    [ROUTER_SHARE_NAME]: {
      version: ROUTER_VERSION,
      module: nextPagesRouterModule,
    },
  })
}
