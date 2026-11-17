import {
  BUILD_ID_PATTERN,
  NAME_PATTERN,
  assertSecureUrl,
  parseAllowInsecureHttp,
} from '@next-federation/protocol'
import type { ReactMode } from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import {
  ISLAND_SHARE_SCOPE,
  packageVersionReader,
  resolveShared,
} from './share.ts'
import { trimTrailingSlashes } from './trim-slashes.ts'

export type IslandRemoteOptions = {
  name: string
  /** Absolute URL where this remote is served, e.g. 'https://shop.example.com/'. */
  base: string
  islands: Record<string, string | { entry: string; private?: boolean }>
  /** Host origins allowed to embed (CORS + Origin check). */
  hosts: string[]
  /** Issuer → JWKS URL. */
  issuers?: Record<string, string>
  buildId?: string
  /** Build-pinned asset paths. Default: true for build, false for serve. */
  versioned?: boolean
  /** Public island `Cache-Control` max-age in seconds. Default 60. */
  maxAge?: number
  /**
   * Output folder, relative to the Vite root. Default 'dist'. Versioned builds
   * go to `<outDir>/<buildId>`, the folder `nf-serve --dir` takes.
   */
  outDir?: string
  /**
   * Share React with the other island remotes on the page (one copy per
   * exact React version). Default: true for build, always false for serve.
   * `libs`: extra bare specifiers shared as exact-version singletons, e.g. a
   * design-system package.
   */
  share?: boolean | { libs?: string[] }
  /**
   * Accept a plain-http `base` and JWKS URLs for non-loopback hosts in a
   * production build (warned once). Default false: http is accepted only for
   * localhost, 127.0.0.0/8 and [::1], the dev server, or NODE_ENV
   * "development" / "test".
   */
  allowInsecureHttp?: boolean
}

export type ResolvedOptions = {
  name: string
  buildId: string
  mode: ReactMode
  /** `versioned ? `${base}b/${buildId}/` : base`; always ends with '/'. */
  publicBase: string
  /** The flight-client registry key. Always `=== publicBase`. */
  scopeKey: string
  /** `versioned ? `${outDir}/${buildId}` : outDir` (`outDir` default 'dist'). */
  outDir: string
  islands: Record<string, { entry: string; private: boolean }>
  hosts: string[]
  issuers: Record<string, string>
  maxAge: number
  /**
   * What this build shares, or null. Always includes react, react-dom,
   * react-dom/client and react/jsx-runtime at the remote's installed exact
   * version.
   */
  share: null | {
    scope: typeof ISLAND_SHARE_SCOPE
    libs: Array<{ name: string; version: string }>
  }
  allowInsecureHttp: boolean
}

export type ResolveContext = {
  command: 'serve' | 'build'
  env: Record<string, string | undefined>
  now: number
  /** A package's installed version. Default: as Node resolves it from the working directory. */
  readVersion?: (pkg: string) => string
  /** Accept plain http as in development. Default: `serve`, or NODE_ENV development/test. */
  development?: boolean
}

const DEFAULT_MAX_AGE = 60

function invalid(detail: string): NFError {
  return new NFError('NF-002', detail)
}

function httpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

type HttpPolicy = { allowInsecureHttp: boolean; development: boolean }

function httpPolicy(
  options: { allowInsecureHttp?: unknown },
  ctx: ResolveContext
): HttpPolicy {
  const env = ctx.env.NODE_ENV
  return {
    allowInsecureHttp: parseAllowInsecureHttp(options.allowInsecureHttp),
    development:
      ctx.development ??
      (ctx.command === 'serve' || env === 'development' || env === 'test'),
  }
}

/** The absolute base, normalised to end with '/'. */
function resolveBase(base: unknown, policy: HttpPolicy): string {
  const url = httpUrl(base)
  if (!url || url.search || url.hash) {
    throw new NFError(
      'NF-020',
      `\`base\` must be an absolute http(s) URL without query or hash, got ${JSON.stringify(base)}.`
    )
  }
  assertSecureUrl(url, 'base', policy)
  const href = url.href
  return href.endsWith('/') ? href : `${href}/`
}

function resolveBuildId(
  options: IslandRemoteOptions,
  ctx: ResolveContext
): string {
  const id =
    options.buildId ??
    ctx.env.NF_BUILD_ID ??
    (ctx.command === 'serve' ? 'dev' : ctx.now.toString(36))
  if (!BUILD_ID_PATTERN.test(id)) {
    throw invalid(
      `buildId must match ${BUILD_ID_PATTERN}, got ${JSON.stringify(id)}.`
    )
  }
  return id
}

function resolveIslands(
  islands: IslandRemoteOptions['islands']
): ResolvedOptions['islands'] {
  const names = Object.keys(islands ?? {})
  if (names.length === 0)
    throw invalid('`islands` must list at least one island.')
  const out: ResolvedOptions['islands'] = {}
  for (const name of names) {
    if (!NAME_PATTERN.test(name)) {
      throw invalid(
        `Island name ${JSON.stringify(name)} must match ${NAME_PATTERN}.`
      )
    }
    const value = islands[name]
    const entry = typeof value === 'string' ? value : value?.entry
    if (typeof entry !== 'string' || entry === '') {
      throw invalid(
        `Island ${JSON.stringify(name)} needs a non-empty entry path.`
      )
    }
    out[name] = {
      entry,
      private: typeof value === 'object' && value.private === true,
    }
  }
  return out
}

function resolveHosts(hosts: unknown): string[] {
  if (!Array.isArray(hosts))
    throw invalid('`hosts` must be an array of origins.')
  for (const host of hosts) {
    const url = httpUrl(host)
    if (host === '*' || !url || url.origin !== host) {
      throw invalid(
        `\`hosts\` entries must be exact origins such as "https://host.example" (no "*", path or trailing slash), got ${JSON.stringify(host)}.`
      )
    }
  }
  return [...hosts]
}

function resolveIssuers(
  issuers: IslandRemoteOptions['issuers'],
  policy: HttpPolicy
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [issuer, jwks] of Object.entries(issuers ?? {})) {
    const url = httpUrl(jwks)
    if (!issuer || !url) {
      throw invalid(
        `Issuer ${JSON.stringify(issuer)} needs an absolute http(s) JWKS URL, got ${JSON.stringify(jwks)}.`
      )
    }
    const issuerUrl = httpUrl(issuer)
    if (issuerUrl) assertSecureUrl(issuerUrl, 'issuers', policy)
    assertSecureUrl(url, `issuers[${issuerUrl?.origin ?? 'issuer'}]`, policy)
    out[issuer] = jwks
  }
  return out
}

function resolveShare(
  share: IslandRemoteOptions['share'],
  ctx: ResolveContext
): ResolvedOptions['share'] {
  const libs =
    share === undefined || share === true
      ? []
      : share === false
        ? null
        : typeof share === 'object' && share !== null
          ? (share.libs ?? [])
          : undefined
  if (libs === undefined || (libs !== null && !Array.isArray(libs))) {
    throw invalid(
      `\`share\` must be a boolean or { libs?: string[] }, got ${JSON.stringify(share)}.`
    )
  }
  // Dev never shares: a dev island loads its modules from the dev server.
  if (libs === null || ctx.command === 'serve') return null
  const readVersion = ctx.readVersion ?? packageVersionReader(process.cwd())
  return { scope: ISLAND_SHARE_SCOPE, libs: resolveShared(libs, readVersion) }
}

/** Validates and normalises the remote plugin options for one Vite command. */
export function resolveOptions(
  options: IslandRemoteOptions,
  ctx: ResolveContext
): ResolvedOptions {
  if (typeof options.name !== 'string' || !NAME_PATTERN.test(options.name)) {
    throw invalid(
      `Remote name ${JSON.stringify(options.name)} must match ${NAME_PATTERN}.`
    )
  }
  const policy = httpPolicy(options, ctx)
  const base = resolveBase(options.base, policy)
  const islands = resolveIslands(options.islands)
  const hosts = resolveHosts(options.hosts)
  const issuers = resolveIssuers(options.issuers, policy)
  const buildId = resolveBuildId(options, ctx)
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw invalid(
      `\`maxAge\` must be a non-negative integer, got ${JSON.stringify(maxAge)}.`
    )
  }
  const outDir = options.outDir ?? 'dist'
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw invalid(
      `\`outDir\` must be a non-empty path, got ${JSON.stringify(outDir)}.`
    )
  }
  const versioned = options.versioned ?? ctx.command === 'build'
  const publicBase = versioned ? `${base}b/${buildId}/` : base
  return {
    name: options.name,
    buildId,
    mode: ctx.command === 'serve' ? 'development' : 'production',
    publicBase,
    scopeKey: publicBase,
    outDir: versioned ? `${trimTrailingSlashes(outDir)}/${buildId}` : outDir,
    islands,
    hosts,
    issuers,
    maxAge,
    share: resolveShare(options.share, ctx),
    allowInsecureHttp: policy.allowInsecureHttp,
  }
}
