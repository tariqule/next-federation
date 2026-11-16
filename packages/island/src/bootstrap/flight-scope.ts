import { FLIGHT_REGISTRY_GLOBAL } from '@next-federation/protocol'

/** What the scoped flight client reads for one build of one remote. */
export type FlightScope = {
  require(id: string): Promise<unknown>
  chunkLoad(id: string): Promise<void>
}

/**
 * Publishes `scope` under `key` (the build's absolute base URL, not its
 * origin, so two builds of one remote coexist on a page). Touches only the
 * `__nf_rsc__` registry; never any bundler or plugin global.
 */
export function registerFlightScope(key: string, scope: FlightScope): void {
  const g = globalThis as Record<string, unknown>
  const registry = (g[FLIGHT_REGISTRY_GLOBAL] ??= {}) as Record<
    string,
    FlightScope
  >
  registry[key] = scope
}
