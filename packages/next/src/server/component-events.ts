// Server-side routing of remote component events to the federation that
// resolved the descriptor. Each federation gets an opaque key, carried on its
// descriptors (`events`), and registered in the process-wide registry with
// the federation held weakly. Never keyed by remote name; no callback ever
// leaves the server (the descriptor only carries the string).
import type { Federation } from '@next-federation/core'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'

const keys = new WeakMap<Federation, string>()

/**
 * A 128-bit non-cryptographic hash (four mixed 32-bit lanes), hex. The key
 * is a routing scope, not authentication; pure JS, so edge routes that
 * import this entry load (no `node:` module).
 */
function hash128(text: string): string {
  let h1 = 0x6a09e667
  let h2 = 0xbb67ae85
  let h3 = 0x3c6ef372
  let h4 = 0xa54ff53a
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1, h2, h3, h4]
    .map((h) => (h >>> 0).toString(16).padStart(8, '0'))
    .join('')
}

/**
 * This process's secret, made on first use (the first key, never at module
 * init) and never sent. Not from `Date.now()` or, in Node, `crypto`
 * randomness, which a cacheComponents prerender flags: the high-resolution
 * clock at that moment (unguessable at nanosecond resolution), plus the
 * clock origin and pid when present. Where there is no `process.hrtime` (an
 * edge isolate, whose clock may be coarse or frozen),
 * `crypto.getRandomValues` instead. Neither: null, and nothing is routed.
 */
function processSecret(): string | null {
  const proc = typeof process === 'undefined' ? undefined : process
  const hrtime = proc?.hrtime as { bigint?: () => bigint } | undefined
  let entropy: string
  if (typeof hrtime?.bigint === 'function') {
    entropy = String(hrtime.bigint())
  } else if (typeof globalThis.crypto?.getRandomValues === 'function') {
    entropy = Array.from(
      globalThis.crypto.getRandomValues(new Uint32Array(4))
    ).join('.')
  } else {
    return null
  }
  return hash128(
    `${entropy}|${performance.now()}|${performance.timeOrigin}|${proc?.pid ?? ''}`
  )
}

/**
 * An opaque key: a hash of this process's secret and an index counting the
 * federations this process created (it only grows, so a key is never reused
 * in a process). Only keys this process issued are routed: events for
 * descriptors cached by another process are not routed (they are still
 * logged). Undefined when the runtime has no source for a secret.
 */
function eventsKey(federation: Federation): string | undefined {
  const registry = componentTrustRegistry()
  const routes = (registry.eventRoutes ??= new Map())
  let key = keys.get(federation)
  if (key === undefined) {
    const secret = (registry.eventProcessSecret ??=
      processSecret() ?? undefined)
    if (secret === undefined) return undefined
    const index = registry.eventRouteCount ?? 0
    registry.eventRouteCount = index + 1
    key = hash128(`${secret}.${index}`)
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
  const events = eventsKey(federation)
  return events === undefined ? descriptor : { ...descriptor, events }
}
