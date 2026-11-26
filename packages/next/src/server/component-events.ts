// Server-side routing of remote component events to the federation that
// resolved the descriptor. Each federation gets an opaque key, carried on its
// descriptors (`events`), and registered in the process-wide registry with
// the federation held weakly. Never keyed by remote name; no callback ever
// leaves the server (the descriptor only carries the string).
import type { Federation } from '@next-federation/core'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'

const keys = new WeakMap<Federation, string>()

/** FNV-1a (32 bit), base 36: a short, stable hash (not a secret). */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** The federation's config identity: its remote names and component origins. */
function configHash(federation: Federation): string {
  const parts = [...federation.remotes].sort().map((name) => {
    try {
      return `${name} ${new URL(federation.componentTarget(name).descriptorUrl).origin}`
    } catch {
      return name
    }
  })
  return hash(parts.join('\n'))
}

/**
 * `<config hash>.<index>`: the index counts the federations with that config
 * this process created (it only grows, so a key is never reused in a
 * process). Deterministic, so a descriptor cached in a shared cache routes in
 * another process to the federation created with the same config at the same
 * position. Residual: processes that create identical-config federations in
 * a different order could route between them.
 */
function eventsKey(federation: Federation): string {
  const registry = componentTrustRegistry()
  const routes = (registry.eventRoutes ??= new Map())
  let key = keys.get(federation)
  if (key === undefined) {
    const counts = (registry.eventRouteCounts ??= new Map())
    const config = configHash(federation)
    const index = counts.get(config) ?? 0
    counts.set(config, index + 1)
    key = `${config}.${index}`
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
