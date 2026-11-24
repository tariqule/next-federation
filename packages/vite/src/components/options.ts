import {
  BUILD_ID_PATTERN,
  DEFAULT_REACT_RANGE,
  HOST_REACT_MODULES,
  assertSecureUrl,
  isNeverFallback,
  isSemverRange,
  parseAllowInsecureHttp,
} from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import {
  routerEntryFile,
  routerSharedEntry,
} from '@next-federation/router/build'
import { trimTrailingSlashes } from '../trim-slashes.ts'

export type ComponentsRemoteOptions = {
  /** Module Federation container name: a JavaScript identifier. */
  name: string
  /** Absolute URL where this remote is served, e.g. 'https://shop.example.com/'. */
  base: string
  /** Exposed modules: `{ './Counter': './src/Counter.tsx' }`. */
  exposes: Record<string, string>
  /**
   * Modules shared with the host, besides React (`react`, `react-dom`,
   * `react-dom/client`, `react/jsx-runtime`, always host-provided). A list of
   * bare specifiers (host-provided, any version), or
   * `{ [specifier]: { requiredVersion, fallback } }`:
   * - `requiredVersion`: a semver range the host's copy must satisfy.
   * - `fallback: true`: bundle this build's own copy, used when the host does
   *   not provide the module or its version does not satisfy the range.
   *   Without it the module is host-provided only, and a missing or
   *   unsatisfying copy renders the host's fallback (NF-036).
   * `next/link`, `next/navigation` and `next/router` can be listed (always
   * host-provided, from a Next.js host). No React, React DOM or Next.js
   * module (any subpath, such as `react-dom/server`) can have a fallback.
   *
   * `@next-federation/router` is shared by default (unless `links: false`
   * or it is listed here): `{ requiredVersion: '>=<major>.<minor>.0 <1.0.0',
   * fallback: true }` on 0.x, `^<version>` from 1.0. The copy this build
   * bundles, and its version, are this plugin's own dependency, never one
   * found in the remote's `node_modules`. The host's router is used when it
   * satisfies the range, else this build's own copy.
   */
  shared?: string[] | Record<string, SharedModuleOptions>
  /**
   * The React versions this remote accepts: a semver range, the
   * `requiredVersion` of `react`, `react-dom`, `react-dom/client` and
   * `react/jsx-runtime`. Default '^19.0.0'. Set '^18.3.0 || ^19.0.0' for a
   * remote that runs on both (it must avoid React 19-only APIs). A host whose
   * React is outside the range renders its fallback (NF-036).
   */
  react?: string
  /**
   * Rewire the remote's own router imports so its links navigate through
   * the host's router: `next/link` and `next/navigation`, and `react-router`
   * and `react-router-dom` when `react-router` is installed, resolve to
   * shims on `@next-federation/router` (shared, above). A React Router link
   * inside a router the remote renders itself (a `MemoryRouter`) keeps using
   * that router. A plain `<a href>` is never intercepted. A specifier listed
   * in `shared` is not rewired. Default true; `false` turns the rewiring and
   * the default `@next-federation/router` entry off.
   */
  links?: boolean
  buildId?: string
  /** Output folder, relative to the Vite root. Default 'dist'; builds go to `<outDir>/<buildId>`. */
  outDir?: string
  /** Build the server (CommonJS) copy hosts render on the server. Default true. */
  ssr?: boolean
  /**
   * Accept a plain-http `base` for a non-loopback host in a production build
   * (warned once). Default false.
   */
  allowInsecureHttp?: boolean
  /**
   * Emit the exposed modules' TypeScript declarations into the build
   * (`client/@mf-types/`, listed and signed in the descriptor) so hosts can
   * download prop types (`nf-types`). Default false (opt-in in 0.x). The
   * declarations of the exposed modules and every local file they import
   * become public, with the literal values of constants, `as const` objects
   * and enums (also ones inlined from outside the root): don't expose a
   * module whose type graph reaches a secret. Without `typescript`, when
   * TypeScript cannot emit them, or when a declaration names an absolute
   * path or a path above the root, the build warns and publishes no types.
   */
  types?: boolean
}

export type SharedModuleOptions = {
  requiredVersion?: string | false
  fallback?: boolean
}

export type ResolvedSharedModule = {
  requiredVersion: string | false
  fallback: boolean
  /**
   * The bundled copy (an absolute path) and its version, when this plugin
   * picks them (`@next-federation/router`: the plugin's own dependency).
   */
  import?: string
  version?: string
}

export type ResolvedComponentsOptions = {
  name: string
  buildId: string
  /** `${base}b/${buildId}/` for a build, `base` for the dev server. */
  publicBase: string
  /** `${outDir}/${buildId}` for a build. */
  outDir: string
  exposes: Record<string, string>
  shared: Record<string, ResolvedSharedModule>
  ssr: boolean
  types: boolean
  links: boolean
}

export type ComponentsResolveContext = {
  command: 'serve' | 'build'
  env: Record<string, string | undefined>
  now: number
}

/** Always host-provided: the remote renders on the host's React. */
export const HOST_REACT: readonly string[] = HOST_REACT_MODULES
/** The Next.js modules a Next host provides to remote components. */
export const NEXT_SHARED: readonly string[] = [
  'next/link',
  'next/navigation',
  'next/router',
]
/** `ROUTER_SHARE_NAME` of `@next-federation/router`. */
export const ROUTER_PACKAGE = '@next-federation/router'
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const BARE_SPECIFIER =
  /^(?:@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(?:\/[\w.@-]+)*$/i

const invalid = (detail: string): NFError => new NFError('NF-002', detail)

function resolveBase(
  value: unknown,
  policy: { allowInsecureHttp: boolean; development: boolean }
): string {
  let url: URL | null = null
  try {
    url = typeof value === 'string' ? new URL(value) : null
  } catch {
    url = null
  }
  if (
    !url ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.search ||
    url.hash
  ) {
    throw new NFError(
      'NF-020',
      `\`base\` must be an absolute http(s) URL without query or hash, got ${JSON.stringify(value)}.`
    )
  }
  assertSecureUrl(url, 'base', policy)
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

function resolveExposes(value: unknown): Record<string, string> {
  const entries =
    typeof value === 'object' && value !== null ? Object.entries(value) : []
  if (entries.length === 0) {
    throw invalid('`exposes` must list at least one module.')
  }
  for (const [key, file] of entries) {
    if (!/^\.\/[A-Za-z0-9_][\w./-]*$/.test(key) || key.includes('..')) {
      throw invalid(
        `Expose keys look like "./Counter", got ${JSON.stringify(key)}.`
      )
    }
    if (typeof file !== 'string' || file === '') {
      throw invalid(`Expose ${JSON.stringify(key)} needs a file path.`)
    }
  }
  return Object.fromEntries(entries) as Record<string, string>
}

function resolveReactRange(value: unknown): string {
  if (value === undefined) return DEFAULT_REACT_RANGE
  if (typeof value !== 'string' || !isSemverRange(value)) {
    throw invalid(
      `\`react\` must be a semver range (such as "^18.3.0 || ^19.0.0"), got ${JSON.stringify(value)}.`
    )
  }
  return value
}

/**
 * This plugin's own `@next-federation/router` (its dependency, never one
 * found from the remote's root): the module a build bundles as its fallback
 * copy (that install's own entry), and the shared entry for it.
 */
export function ownRouter(): ResolvedSharedModule & {
  import: string
  version: string
} {
  const entry = routerSharedEntry()[ROUTER_PACKAGE]
  return {
    requiredVersion: entry.requiredVersion,
    fallback: true,
    // The file itself: Module Federation for Vite resolves a bare `import`
    // from the remote's root. It stays out of the build's output.
    import: routerEntryFile(),
    version: entry.version,
  }
}

function resolveSharedOption(
  value: ComponentsRemoteOptions['shared'],
  context: { reactRange: string; links: boolean }
): ResolvedComponentsOptions['shared'] {
  const out: ResolvedComponentsOptions['shared'] = {}
  for (const name of HOST_REACT) {
    out[name] = { requiredVersion: context.reactRange, fallback: false }
  }
  const extra: Array<[string, SharedModuleOptions]> = Array.isArray(value)
    ? value.map((name) => [name, {}])
    : Object.entries(value ?? {})
  // Not listed: shared with a fallback, this plugin's own copy (what the
  // rewired router imports use).
  if (context.links && !extra.some(([name]) => name === ROUTER_PACKAGE)) {
    out[ROUTER_PACKAGE] = ownRouter()
  }
  for (const [name, config] of extra) {
    if (typeof name !== 'string' || !BARE_SPECIFIER.test(name)) {
      throw invalid(
        `\`shared\` entries must be bare package specifiers, got ${JSON.stringify(name)}.`
      )
    }
    if (HOST_REACT.includes(name)) {
      throw invalid(
        `${JSON.stringify(name)} is always host-provided; remove it from \`shared\`.`
      )
    }
    const isNext = name === 'next' || name.startsWith('next/')
    if (isNext && !NEXT_SHARED.includes(name)) {
      throw invalid(
        `Only ${NEXT_SHARED.join(', ')} can be shared from Next.js (the host provides them); ${JSON.stringify(name)} cannot.`
      )
    }
    const range = config?.requiredVersion ?? false
    if (
      range !== false &&
      (typeof range !== 'string' || !isSemverRange(range))
    ) {
      throw invalid(
        `\`shared[${JSON.stringify(name)}].requiredVersion\` must be a semver range (such as "^2.0.0") or false.`
      )
    }
    const fallback = config?.fallback ?? false
    if (typeof fallback !== 'boolean') {
      throw invalid(
        `\`shared[${JSON.stringify(name)}].fallback\` must be true or false.`
      )
    }
    if (fallback && isNeverFallback(name)) {
      throw invalid(
        `${JSON.stringify(name)} cannot have a fallback: React, React DOM and Next.js modules are always the host's (a second copy breaks hooks, context or the router).`
      )
    }
    out[name] =
      name === ROUTER_PACKAGE && fallback
        ? // The bundled copy is still this plugin's own.
          { ...ownRouter(), requiredVersion: range }
        : { requiredVersion: range, fallback }
  }
  return out
}

/** Validates and normalises the components remote options for one Vite command. */
export function resolveComponentsOptions(
  options: ComponentsRemoteOptions,
  ctx: ComponentsResolveContext
): ResolvedComponentsOptions {
  if (typeof options.name !== 'string' || !IDENTIFIER.test(options.name)) {
    throw invalid(
      `Components remote name ${JSON.stringify(options.name)} must match ${IDENTIFIER} (it names the Module Federation container).`
    )
  }
  const env = ctx.env.NODE_ENV
  const base = resolveBase(options.base, {
    allowInsecureHttp: parseAllowInsecureHttp(options.allowInsecureHttp),
    development:
      ctx.command === 'serve' || env === 'development' || env === 'test',
  })
  const exposes = resolveExposes(options.exposes)
  const buildId =
    options.buildId ??
    ctx.env.NF_BUILD_ID ??
    (ctx.command === 'serve' ? 'dev' : ctx.now.toString(36))
  if (!BUILD_ID_PATTERN.test(buildId)) {
    throw invalid(
      `buildId must match ${BUILD_ID_PATTERN}, got ${JSON.stringify(buildId)}.`
    )
  }
  const outDir = trimTrailingSlashes(options.outDir ?? 'dist')
  if (outDir.trim() === '') {
    throw invalid('`outDir` must be a non-empty path.')
  }
  if (options.types !== undefined && typeof options.types !== 'boolean') {
    throw invalid('`types` must be true or false.')
  }
  if (options.links !== undefined && typeof options.links !== 'boolean') {
    throw invalid('`links` must be true or false.')
  }
  const links = options.links ?? true
  const build = ctx.command === 'build'
  return {
    name: options.name,
    buildId,
    publicBase: build ? `${base}b/${buildId}/` : base,
    outDir: build ? `${outDir}/${buildId}` : outDir,
    exposes,
    shared: resolveSharedOption(options.shared, {
      reactRange: resolveReactRange(options.react),
      links,
    }),
    ssr: options.ssr ?? true,
    types: options.types ?? false,
    links,
  }
}
