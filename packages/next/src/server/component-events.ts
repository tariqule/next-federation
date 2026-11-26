// Server-side routing of remote component events to the federation that
// resolved the descriptor. Each federation gets an opaque key, carried on its
// descriptors (`events`), and registered in the process-wide registry with
// the federation held weakly. Never keyed by remote name; no callback ever
// leaves the server (the descriptor only carries the string).
import type { Federation } from '@next-federation/core'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'

const keys = new WeakMap<Federation, string>()

function processId(): string {
  const origin = Math.round(performance.timeOrigin * 1000).toString(36)
  const pid = typeof process === 'undefined' ? 0 : process.pid
  return `${origin}-${pid.toString(36)}`
}

/**
 * `<process id>.<index>`: the process id is made once per process (in the
 * process-wide registry) from its clock origin (microseconds) and pid, never
 * from randomness, which a cacheComponents prerender would flag; the index counts the federations this
 * process created (it only grows, so a key is never reused in a process).
 * Only keys this process issued are routed: events for descriptors cached by
 * another process are not routed (they are still logged).
 */
function eventsKey(federation: Federation): string {
  const registry = componentTrustRegistry()
  const routes = (registry.eventRoutes ??= new Map())
  let key = keys.get(federation)
  if (key === undefined) {
    const id = (registry.eventProcessId ??= processId())
    const index = registry.eventRouteCount ?? 0
    registry.eventRouteCount = index + 1
    key = `${id}.${index}`
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
