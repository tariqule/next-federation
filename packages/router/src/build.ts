// Build helpers for remote builds (Node only): the aliases that rewire a
// remote's own router imports to this package's shims, and the shared entry
// for this package. The Vite plugin uses them; Rspack and webpack remotes put
// them in their own config.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTER_VERSION } from './version.ts'

const ROUTER_PACKAGE = '@next-federation/router'

/** The specifier the React Router shim imports the real package by. */
const REAL_REACT_ROUTER = '@next-federation/router/real-react-router'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * A shim file of this install (absolute): `dist/shims/<name>.js`, or
 * `src/shims/<name>.ts(x)` in source.
 */
export function routerShimFile(
  name: 'next-link' | 'next-navigation' | 'react-router'
): string {
  return shim(name)
}

function shim(name: string): string {
  const base = join(here, 'shims', name)
  const file = ['.js', '.tsx', '.ts'].map((ext) => base + ext).find(existsSync)
  if (!file) throw new Error(`@next-federation/router: missing ${base}.js`)
  return file
}

/**
 * The directory of the `react-router` installed for `root`: the nearest
 * `node_modules/react-router` of `root` or a parent folder, as a bundler
 * looks it up (never NODE_PATH or global folders); null when there is none.
 */
export function reactRouterDirectory(root: string): string | null {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const pkg = join(dir, 'node_modules', 'react-router')
    try {
      const { name } = JSON.parse(
        readFileSync(join(pkg, 'package.json'), 'utf8')
      ) as { name?: unknown }
      if (name === 'react-router') return realpathSync(pkg)
    } catch {
      // Not installed here: look in the parent folder.
    }
    if (dir === dirname(dir)) return null
  }
}

/**
 * Exact aliases (`$` keys) from a remote's router imports to the shims of
 * this install (absolute paths): `next/link` and `next/navigation`, and with
 * `reactRouter`, `react-router` and `react-router-dom`. For Rspack and
 * webpack `resolve.alias`.
 *
 * `@next-federation/router` itself goes to this install's entry, the file
 * `routerSharedEntry()` bundles as its fallback copy: a copy in some other
 * `node_modules` (a parent folder of the project) never gets into the build,
 * and the shared entry names the package, never a path of this machine.
 *
 * With `reactRouter`, the shim reaches the real package through one more
 * alias, to the `react-router` directory `root` resolves (default: the
 * working directory): an import of `react-router` from the shim would be
 * aliased back to the shim.
 */
export function routerShimAliases(
  options: { reactRouter?: boolean; root?: string } = {}
): Record<string, string> {
  const aliases: Record<string, string> = {
    [`${ROUTER_PACKAGE}$`]: ownEntry(),
    'next/link$': shim('next-link'),
    'next/navigation$': shim('next-navigation'),
  }
  if (options.reactRouter) {
    const root = options.root ?? process.cwd()
    const real = reactRouterDirectory(root)
    if (real === null) {
      throw new Error(
        `@next-federation/router: routerShimAliases({ reactRouter: true }) needs react-router installed in ${resolve(root)}.`
      )
    }
    const reactRouter = shim('react-router')
    aliases['react-router$'] = reactRouter
    aliases['react-router-dom$'] = reactRouter
    aliases[`${REAL_REACT_ROUTER}$`] = real
  }
  return aliases
}

/** `>=<major>.<minor>.0 <1.0.0` on 0.x, `^<version>` from 1.0. */
function routerRange(version: string): string {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(version)
  if (!match) throw new Error(`@next-federation/router: bad version ${version}`)
  return match[1] === '0' ? `>=0.${match[2]}.0 <1.0.0` : `^${version}`
}

/**
 * This install's own entry (absolute): the `.` export of the `package.json`
 * above this file (a bundler given this path never looks for the package
 * elsewhere). For a build tool whose shared config never reaches its output
 * (the Vite plugin); an Rspack or webpack build gets it through
 * `routerShimAliases()`.
 */
export function routerEntryFile(): string {
  return ownEntry()
}

function ownEntry(): string {
  for (let dir = here; dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name?: unknown
      exports?: Record<string, unknown>
    }
    if (pkg.name !== '@next-federation/router') continue
    const dot = pkg.exports?.['.']
    const target =
      typeof dot === 'string'
        ? dot
        : (dot as { default?: unknown } | undefined)?.default
    if (typeof target !== 'string') break
    return join(dir, target)
  }
  throw new Error(`@next-federation/router: no package entry above ${here}`)
}

/**
 * The Module Federation shared entry for this package: never a singleton, so
 * the build bundles its own copy, used only when the host's router does not
 * satisfy the range. `import` is the package name, never a path: Module
 * Federation copies it into the published remoteEntry.js. Use it with
 * `routerShimAliases()`, whose `@next-federation/router$` alias makes that
 * name this install's entry.
 */
export function routerSharedEntry(): {
  '@next-federation/router': {
    singleton: false
    version: string
    requiredVersion: string
    import: '@next-federation/router'
  }
} {
  return {
    '@next-federation/router': {
      singleton: false,
      version: ROUTER_VERSION,
      requiredVersion: routerRange(ROUTER_VERSION),
      import: ROUTER_PACKAGE,
    },
  }
}
