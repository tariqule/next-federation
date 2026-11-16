import {
  BUILD_ID_PATTERN,
  assertSecureUrl,
  isSemverRange,
  parseAllowInsecureHttp,
} from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'

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
   * host-provided, from a Next.js host; never a fallback).
   */
  shared?: string[] | Record<string, SharedModuleOptions>
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
}

export type SharedModuleOptions = {
  requiredVersion?: string | false
  fallback?: boolean
}

export type ResolvedSharedModule = {
  requiredVersion: string | false
  fallback: boolean
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
}

export type ComponentsResolveContext = {
  command: 'serve' | 'build'
  env: Record<string, string | undefined>
  now: number
}

/** Always host-provided: the remote renders on the host's React. */
export const HOST_REACT: readonly string[] = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
]
/** The Next.js modules a Next host provides to remote components. */
export const NEXT_SHARED: readonly string[] = [
  'next/link',
  'next/navigation',
  'next/router',
]
const REACT_RANGE = '^19.0.0'
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

function resolveSharedOption(
  value: ComponentsRemoteOptions['shared']
): ResolvedComponentsOptions['shared'] {
  const out: ResolvedComponentsOptions['shared'] = {}
  for (const name of HOST_REACT) {
    out[name] = { requiredVersion: REACT_RANGE, fallback: false }
  }
  const extra: Array<[string, SharedModuleOptions]> = Array.isArray(value)
    ? value.map((name) => [name, {}])
    : Object.entries(value ?? {})
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
    if (fallback && isNext) {
      throw invalid(
        `${JSON.stringify(name)} cannot have a fallback: it is always the host's (a copy would not see the host's router).`
      )
    }
    out[name] = { requiredVersion: range, fallback }
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
  const outDir = (options.outDir ?? 'dist').replace(/\/+$/, '')
  if (outDir.trim() === '') {
    throw invalid('`outDir` must be a non-empty path.')
  }
  const build = ctx.command === 'build'
  return {
    name: options.name,
    buildId,
    publicBase: build ? `${base}b/${buildId}/` : base,
    outDir: build ? `${outDir}/${buildId}` : outDir,
    exposes,
    shared: resolveSharedOption(options.shared),
    ssr: options.ssr ?? true,
  }
}
