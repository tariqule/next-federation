// Server-side routing of remote component events to the federation that
// resolved the descriptor. Each federation gets an opaque key, carried on its
// descriptors (`events`), and registered in the process-wide registry with
// the federation held weakly. Never keyed by remote name; no callback ever
// leaves the server (the descriptor only carries the string).
import type { Federation } from '@next-federation/core'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'

const keys = new WeakMap<Federation, string>()

// Distinct per process (a cached descriptor from an earlier process must not
// route to another federation), without randomness a prerender would flag.
const processId = Math.round(performance.timeOrigin * 1000).toString(36)

function eventsKey(federation: Federation): string {
  let key = keys.get(federation)
  const registry = componentTrustRegistry()
  const routes = (registry.eventRoutes ??= new Map())
  if (key === undefined) {
    let n = routes.size
    while (routes.has(`${processId}.${n}`)) n++
    key = `${processId}.${n}`
    keys.set(federation, key)
  }
  if (routes.get(key)?.deref() !== federation) {
    routes.set(key, new WeakRef(federation))
  }
  return key
}

/** The descriptor, carrying the key of the federation that resolved it. */
export function withEvents(
  federation: Federation,
  descriptor: RemoteComponentDescriptor
): RemoteComponentDescriptor {
  return { ...descriptor, events: eventsKey(federation) }
}
