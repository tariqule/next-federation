/**
 * The page-wide React share scope of next-federation islands (Task 18B).
 *
 * It lives in the Module Federation global map, `__FEDERATION__.__SHARE__`,
 * and keeps Module Federation's entry shape, but under a key that only this
 * library uses: `__SHARE__[ISLAND_SHARE_NAMESPACE][ISLAND_SHARE_SCOPE]`. A
 * real Module Federation host on the same page keys its own scopes by its
 * instance name, so the two never read each other's entries. The `@1` is the
 * version of this layout: a copy of the library with another layout uses
 * another key instead of misreading this one.
 */
export const ISLAND_SHARE_NAMESPACE = '@next-federation/island-share@1'
/** The share scope name inside the namespace. */
export const ISLAND_SHARE_SCOPE = 'nf-islands'

/**
 * One provider of one exact version of a shared module, in Module
 * Federation's shape. `get` loads the provider's copy and resolves to a
 * factory; once loaded, `lib` returns the module.
 */
export type IslandSharedEntry = {
  version: string
  /** Who registered it: a remote's public base, or `'host'`. */
  from: string
  scope: string[]
  loaded?: boolean
  loading?: Promise<() => unknown>
  lib?: () => unknown
  get: () => Promise<() => unknown>
  strategy: 'loaded-first'
  shareConfig: {
    singleton: false
    strictVersion: true
    requiredVersion: string
    eager: false
  }
  useIn: string[]
  deps: string[]
}

/** `scope[name][version]`, one provider per exact version. */
export type IslandShareScope = Record<string, Record<string, IslandSharedEntry>>

type FederationGlobal = {
  __FEDERATION__?: { __SHARE__?: Record<string, Record<string, unknown>> }
}

/** The page's island share scope, created on first use. */
export function islandShareScope(): IslandShareScope {
  const g = globalThis as FederationGlobal
  const federation = (g.__FEDERATION__ ??= {})
  const share = (federation.__SHARE__ ??= {})
  const namespace = (share[ISLAND_SHARE_NAMESPACE] ??= {})
  return (namespace[ISLAND_SHARE_SCOPE] ??= {}) as IslandShareScope
}

/** A provider entry for `version` of `name`; `from` names the provider. */
export function islandSharedEntry(
  version: string,
  from: string,
  get: () => Promise<() => unknown>
): IslandSharedEntry {
  return {
    version,
    from,
    scope: [ISLAND_SHARE_SCOPE],
    get,
    strategy: 'loaded-first',
    shareConfig: {
      singleton: false,
      strictVersion: true,
      requiredVersion: version,
      eager: false,
    },
    useIn: [],
    deps: [],
  }
}
