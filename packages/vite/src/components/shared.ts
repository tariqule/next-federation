// Shared modules of a components remote: the Module Federation config, and
// which exposes import which module (the descriptor's `shared` field itself
// is built by @next-federation/server/node's sharedFromManifest, shared with
// nf-describe).
import type { ResolvedComponentsOptions } from './options.ts'

type MfShareItem =
  | { singleton: true; requiredVersion: string | false; import: false }
  | {
      singleton: false
      requiredVersion: string | false
      import?: string
      version?: string
    }

/**
 * Host-provided modules are `import: false` singletons (never bundled, always
 * the host's copy). A `fallback` module is bundled and not a singleton: its
 * share proxy looks up `<name>@<bundled version>` in Module Federation's
 * module cache, where the host runtime puts its own copy when that copy
 * satisfies `requiredVersion` (the descriptor carries the bundled version),
 * and uses the bundled copy otherwise. A module this plugin picks the copy
 * of (`@next-federation/router`) names that file and its version.
 */
export function mfSharedConfig(
  resolved: Pick<ResolvedComponentsOptions, 'shared'>
): Record<string, MfShareItem> {
  return Object.fromEntries(
    Object.entries(resolved.shared).map(
      ([name, { requiredVersion, fallback, import: file, version }]) => [
        name,
        fallback
          ? {
              singleton: false as const,
              requiredVersion,
              ...(file === undefined ? {} : { import: file }),
              ...(version === undefined ? {} : { version }),
            }
          : {
              singleton: true as const,
              requiredVersion,
              import: false as const,
            },
      ]
    )
  )
}

/** Expose key -> the shared specifiers its module graph imports. */
export type SharedUsage = Map<string, Set<string>>

type ModuleInfo = {
  importedIds: readonly string[]
  dynamicallyImportedIds: readonly string[]
}

const clean = (id: string) => id.split('?')[0]!

/**
 * Walks each expose's module graph (static and dynamic imports) and unions
 * the shared specifiers its modules import (`imports`: module id -> the
 * shared specifiers it imports, recorded while resolving). null when an
 * expose is not in the graph: then nothing is known, never too little.
 */
export function collectSharedUsage(
  exposes: Record<string, string>,
  getModuleInfo: (id: string) => ModuleInfo | null,
  imports: Map<string, Set<string>>
): SharedUsage | null {
  const usage: SharedUsage = new Map()
  for (const [expose, file] of Object.entries(exposes)) {
    if (!getModuleInfo(file)) return null
    const names = new Set<string>()
    const seen = new Set<string>()
    const queue = [file]
    while (queue.length > 0) {
      const id = queue.pop()!
      if (seen.has(clean(id))) continue
      seen.add(clean(id))
      for (const name of imports.get(clean(id)) ?? []) names.add(name)
      const info = getModuleInfo(id)
      if (!info) continue
      queue.push(...info.importedIds, ...info.dynamicallyImportedIds)
    }
    usage.set(expose, names)
  }
  return usage
}
