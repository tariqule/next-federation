import { islandSharedEntry, islandShareScope } from '@next-federation/protocol'
import type { IslandSharedEntry } from '@next-federation/protocol'
import { logger } from '@next-federation/sdk'

/** One shared module of this build: its exact version and its bundled copy. */
export type IslandSharedLib = {
  name: string
  version: string
  /** Loads this build's own copy. */
  get: () => Promise<unknown>
}

/** React's own entries, shared under their exact version. */
const REACT_LIBS = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
])

/**
 * The scope key of a lib. React's entries: their exact version. Any other
 * lib is bound to the React its copy imports, so it is keyed by both
 * (`1.0.0+react@19.3.1`): a copy built against another React is never taken.
 */
export function sharedKey(
  name: string,
  version: string,
  reactVersion: string | undefined
): string {
  return REACT_LIBS.has(name) ? version : `${version}+react@${reactVersion}`
}

/** Resolves an entry's module, loading the provider's copy once per page. */
function load(entry: IslandSharedEntry): Promise<unknown> {
  if (entry.loaded && entry.lib) return Promise.resolve(entry.lib())
  entry.loading ??= entry.get().then((factory) => {
    entry.lib = factory
    entry.loaded = true
    return factory
  })
  return entry.loading.then((factory) => factory())
}

export type IslandShareOptions = {
  /** Filled as libs resolve; what the promise returns. */
  resolved?: Map<string, unknown>
  /** Names this build in the entries it provides (its public base). */
  from?: string
}

/**
 * Shares this build's React (and any extra libs) through the page's island
 * share scope, one provider per key: for each lib it registers this build's
 * copy unless a provider with the same key is already there, then resolves
 * the lib to that provider's copy (the first one registered wins). The key is
 * the exact version, plus the React version for a lib other than React's own
 * (`sharedKey`). Libs of one name@key may come from different providers; each
 * name@key is one object on the page.
 * Libs resolve in order, so a copy that imports an earlier lib (react-dom
 * imports react) finds it in `resolved`.
 *
 * Never rejects because of the share scope: any failure there falls back to
 * this build's own copies (logged once). It rejects only if an own copy fails
 * to load, which the island would not survive anyway.
 */
export async function initIslandShareScope(
  shared: IslandSharedLib[],
  options: IslandShareOptions = {}
): Promise<ReadonlyMap<string, unknown>> {
  const resolved = options.resolved ?? new Map<string, unknown>()
  const from = options.from ?? 'island'
  let pending:
    | {
        versions: Record<string, IslandSharedEntry>
        version: string
        entry: IslandSharedEntry
      }
    | undefined
  try {
    const scope = islandShareScope()
    const reactVersion = shared.find((lib) => lib.name === 'react')?.version
    // Every entry is registered before anything loads. A build that starts
    // later therefore finds all of this build's providers or none, and waits
    // behind this build for each of them, so a provider's copy of react-dom
    // never evaluates before that provider resolved react.
    const entries = shared.map(({ name, version, get }) => {
      const versions = (scope[name] ??= {})
      const key = sharedKey(name, version, reactVersion)
      const entry = (versions[key] ??= islandSharedEntry(version, from, () =>
        get().then((lib) => () => lib)
      ))
      return { versions, version: key, entry }
    })
    for (const [i, { name }] of shared.entries()) {
      pending = entries[i]!
      resolved.set(name, await load(pending.entry))
    }
    return resolved
  } catch (error) {
    // A provider whose copy failed to load leaves the scope, so a build that
    // starts later provides its own.
    if (pending && pending.versions[pending.version] === pending.entry) {
      delete pending.versions[pending.version]
    }
    logger.warnOnce(
      'NF-011',
      'share-scope',
      `React sharing failed, so this island uses its own bundled copy: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  // All or nothing: a lib from the scope next to an own copy of another could
  // pair two Reacts.
  resolved.clear()
  for (const { name, get } of shared) resolved.set(name, await get())
  return resolved
}
