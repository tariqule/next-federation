import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { ISLAND_SHARE_SCOPE } from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import { normalizePath } from 'vite'
import type { Plugin, Rolldown } from 'vite'
import { codeLiteral } from './code-literal.ts'

export { ISLAND_SHARE_SCOPE }

/**
 * Always shared, in load order: each one's own imports come before it
 * (react-dom imports react). The browser flight client is never shared: it
 * holds per-build state (`scopeFlightClient`).
 */
export const REACT_SHARED: readonly string[] = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
]

const NEVER_SHARED = /^react-server-dom-webpack(?:\/|$)/
const BARE_SPECIFIER =
  /^(?:@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(?:\/[\w.@-]+)*$/i

/** The package a bare specifier belongs to: `@a/b/c` -> `@a/b`, `x/y` -> `x`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

/**
 * The shared modules of a build: the four React entries, then `libs`, each at
 * the exact version of its installed package. NF-002 for
 * `react-server-dom-webpack` (never shareable), a specifier that is not a
 * bare package import, or a version that cannot be read.
 */
export function resolveShared(
  libs: string[],
  readVersion: (pkg: string) => string
): Array<{ name: string; version: string }> {
  const names = [...REACT_SHARED]
  for (const lib of libs) {
    if (typeof lib !== 'string' || !BARE_SPECIFIER.test(lib)) {
      throw new NFError(
        'NF-002',
        `\`share.libs\` entries must be bare package specifiers such as "@acme/design", got ${JSON.stringify(lib)}.`
      )
    }
    if (NEVER_SHARED.test(lib)) {
      throw new NFError(
        'NF-002',
        `${JSON.stringify(lib)} cannot be shared: the flight client keeps per-build state.`
      )
    }
    if (!names.includes(lib)) names.push(lib)
  }
  const versions = new Map<string, string>()
  return names.map((name) => {
    const pkg = packageOf(name)
    let version = versions.get(pkg)
    if (version === undefined) {
      try {
        version = readVersion(pkg)
      } catch (error) {
        throw new NFError(
          'NF-002',
          `Cannot read the installed version of ${JSON.stringify(pkg)} to share ${JSON.stringify(name)}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      if (typeof version !== 'string' || version === '') {
        throw new NFError(
          'NF-002',
          `Cannot read the installed version of ${JSON.stringify(pkg)} to share ${JSON.stringify(name)}.`
        )
      }
      versions.set(pkg, version)
    }
    return { name, version }
  })
}

/** The `version` of the nearest `package.json` named `pkg` above `file`. */
export function versionNear(file: string, pkg: string): string {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8')
      ) as { name?: string; version?: string }
      if (manifest.name === pkg && manifest.version) return manifest.version
    } catch {
      // No package.json here.
    }
    if (dirname(dir) === dir) {
      throw new Error(`No package.json named ${pkg} above ${file}`)
    }
  }
}

/** Reads a package's installed version as Node resolves it from `root`. */
export function packageVersionReader(root: string): (pkg: string) => string {
  const require = createRequire(join(root, 'package.json'))
  return (pkg) => {
    let manifest: string
    try {
      manifest = require.resolve(`${pkg}/package.json`)
    } catch {
      // `exports` without "./package.json": walk up from the entry instead.
      return versionNear(require.resolve(pkg), pkg)
    }
    return versionNear(manifest, pkg)
  }
}

/** Module ids of the share layer (client environment, production only). */
const VIRTUAL_SHARE = 'virtual:next-federation/share'
const VIRTUAL_SHARE_LOCAL = 'virtual:next-federation/share-local'
const SHARED_PREFIX = '\0virtual:next-federation/shared/'
/**
 * The share-scope subpath, never the bootstrap barrel: the barrel's other
 * modules import React, and the init module must run before any of them.
 */
const SHARE_SCOPE_MODULE = '@next-federation/island/share-scope'
/** Set on the nested resolve that finds a bundled copy, so it is not a stub again. */
const LOCAL_RESOLVE = 'nf-share-local'

export type SharePluginContext = {
  /** The resolved options; `share` is null when this build does not share. */
  options: () => ResolvedShareOptions
  /** The client entry: the module an envelope's `bootstrap` URL names. */
  clientEntry: string
  /** The module that builds the island bootstrap (`mountIsland`). */
  clientBootstrap: string
}

type ResolvedShareOptions = {
  publicBase: string
  share: null | { libs: Array<{ name: string; version: string }> }
}

const json = codeLiteral

/** The init module: resolves every shared lib, then the stubs read them. */
function initModule(
  libs: Array<{ name: string; version: string }>,
  from: string,
  shareScopeId: string
): string {
  const entries = libs.map(
    ({ name, version }) =>
      `  { name: ${json(name)}, version: ${json(version)}, get: () => own().then((m) => m.default[${json(name)}]()) },`
  )
  return `import { initIslandShareScope } from ${json(shareScopeId)}
const own = () => import(${json(VIRTUAL_SHARE_LOCAL)})
const resolved = new Map()
export const ready = initIslandShareScope([
${entries.join('\n')}
], { resolved, from: ${json(from)} })
export function get(name) {
  if (!resolved.has(name)) throw new Error('next-federation: ' + name + ' was imported before the island share scope was ready.')
  return resolved.get(name)
}
`
}

/** The bundled copies, one lazy getter each, in one chunk. */
function localModule(ids: Map<string, string>): string {
  const lines = [...ids].map(
    ([name, id]) => `  ${json(name)}: () => require(${json(id)}),`
  )
  return `module.exports = {\n${lines.join('\n')}\n}\n`
}

/**
 * Production client builds: shares React (and `share.libs`) across the island
 * remotes on a page through the island share scope:
 *
 * 1. The client entry becomes an async boundary: it awaits the share scope,
 *    then imports the real bootstrap, so every module that imports React runs
 *    after the shared copies are known.
 * 2. Bare imports of a shared lib, from any module (island code, the
 *    flight client, React's own CommonJS requires), become a CommonJS stub
 *    that returns the resolved copy, so all of them get the very same object.
 * 3. The bundled copies sit behind one lazy chunk, `react-*.js`, downloaded
 *    only when this build provides them.
 *
 * The flight client is never shared: it stays in this build's chunks, still
 * scoped by `scopeFlightClient`, and reaches React through the stubs.
 */
export function islandSharePlugin(ctx: SharePluginContext): Plugin {
  const share = () => ctx.options().share
  const localIds = new Map<string, string>()
  let shareScopeId = SHARE_SCOPE_MODULE
  const isShared = (id: string) =>
    share()?.libs.some((lib) => lib.name === id) ?? false
  return {
    name: 'nf:share',
    // Before Vite's resolver, so bare shared imports become the stubs.
    enforce: 'pre',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    configEnvironment(name) {
      if (name !== 'client' || !share()) return undefined
      return {
        build: {
          rollupOptions: {
            output: {
              // Only the bundled copies are named `react*`; the small stubs
              // and the init module never are. Checked when chunks are named:
              // a non-production build turns sharing off after this hook.
              chunkFileNames: (chunk: Rolldown.PreRenderedChunk) =>
                !share()
                  ? 'assets/[name]-[hash].js'
                  : chunk.facadeModuleId === `\0${VIRTUAL_SHARE_LOCAL}`
                    ? 'assets/react-[hash].js'
                    : /react|jsx/i.test(chunk.name)
                      ? 'assets/share-[hash].js'
                      : 'assets/[name]-[hash].js',
            },
          },
        },
      }
    },
    async buildStart() {
      const libs = share()?.libs
      if (!libs) return
      const importer = normalizePath(
        join(this.environment.config.root, 'index.html')
      )
      localIds.clear()
      // As this package resolves it, so the app need not depend on it.
      const scopeModule = await this.resolve(
        SHARE_SCOPE_MODULE,
        ctx.clientBootstrap
      )
      if (!scopeModule) {
        throw new NFError('NF-002', `Cannot resolve ${SHARE_SCOPE_MODULE}.`)
      }
      shareScopeId = scopeModule.id
      // The copies this build actually bundles, as every other plugin
      // resolves them; their versions are the ones this build shares under.
      const found: Array<{ name: string; version: string }> = []
      for (const { name } of libs) {
        const result = await this.resolve(name, importer, {
          custom: { [LOCAL_RESOLVE]: true },
        })
        if (!result || result.external) {
          throw new NFError(
            'NF-002',
            `Cannot resolve ${JSON.stringify(name)} to share it with other island remotes.`
          )
        }
        const file = result.id.split('?')[0]!
        localIds.set(name, file)
        found.push({ name, version: versionNear(file, packageOf(name)) })
      }
      share()!.libs = found
    },
    resolveId: {
      filter: {
        id: /^(?:virtual:next-federation\/share(?:-local)?$|[^./\0])/,
      },
      handler(source, _importer, options) {
        if (!share()) return undefined
        if (source === VIRTUAL_SHARE || source === VIRTUAL_SHARE_LOCAL) {
          return `\0${source}`
        }
        if (!isShared(source)) return undefined
        // The nested resolve of a bundled copy (buildStart, possibly through
        // another plugin that re-resolves with its own importer).
        if (options.custom?.[LOCAL_RESOLVE]) return undefined
        return `${SHARED_PREFIX}${source}`
      },
    },
    load: {
      filter: {
        id: /^\0virtual:next-federation\/shar|entry\.client\.[jt]sx?$/,
      },
      handler(id) {
        const libs = share()?.libs
        if (!libs) return undefined
        if (id === `\0${VIRTUAL_SHARE}`) {
          return initModule(libs, ctx.options().publicBase, shareScopeId)
        }
        if (id === `\0${VIRTUAL_SHARE_LOCAL}`) return localModule(localIds)
        if (id.startsWith(SHARED_PREFIX)) {
          // CommonJS, so React's own `require('react')` gets the same object.
          const name = id.slice(SHARED_PREFIX.length)
          return `module.exports = require(${json(VIRTUAL_SHARE)}).get(${json(name)})\n`
        }
        if (normalizePath(id.split('?')[0]!) === ctx.clientEntry) {
          return `import { ready } from ${json(VIRTUAL_SHARE)}
await ready
const bootstrap = await import(${json(ctx.clientBootstrap)})
export const mountIsland = bootstrap.mountIsland
`
        }
        return undefined
      },
    },
  }
}
