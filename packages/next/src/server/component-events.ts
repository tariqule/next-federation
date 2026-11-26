// Server-side routing of remote component events to the federation that
// resolved the descriptor. Each federation gets an opaque key, carried on its
// descriptors (`events`), and registered in the process-wide registry with
// the federation held weakly. Never keyed by remote name; no callback ever
// leaves the server (the descriptor only carries the string).
import { createHash } from 'node:crypto'
import type { Federation } from '@next-federation/core'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'

const keys = new WeakMap<Federation, string>()

/**
 * This process's secret, made on first use. Not from `crypto` randomness or
 * `Date.now()`, which a cacheComponents prerender flags: SHA-256 over the
 * high-resolution clock at that moment (unguessable at nanosecond
 * resolution) plus the clock origin and pid when present. Never sent: keys
 * are hashes of it, so they reveal neither pid nor start time.
 */
function processSecret(): string {
  const hr =
    typeof process !== 'undefined' &&
    typeof process.hrtime?.bigint === 'function'
      ? String(process.hrtime.bigint())
      : ''
  const pid = typeof process !== 'undefined' ? String(process.pid) : ''
  return createHash('sha256')
    .update(`${hr}|${performance.now()}|${performance.timeOrigin}|${pid}`)
    .digest('hex')
}

/**
 * An opaque key: SHA-256 of this process's secret and an index counting the
 * federations this process created (it only grows, so a key is never reused
 * in a process). Only keys this process issued are routed: events for
 * descriptors cached by another process are not routed (they are still
 * logged).
 */
function eventsKey(federation: Federation): string {
  const registry = componentTrustRegistry()
  const routes = (registry.eventRoutes ??= new Map())
  let key = keys.get(federation)
  if (key === undefined) {
    const secret = (registry.eventProcessSecret ??= processSecret())
    const index = registry.eventRouteCount ?? 0
    registry.eventRouteCount = index + 1
    key = createHash('sha256')
      .update(`${secret}.${index}`)
      .digest('hex')
      .slice(0, 32)
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
