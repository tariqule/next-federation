import type { NextConfig } from 'next'
import { NFError } from '@next-federation/sdk'
import { installedNext, nextProjectDir } from './installed-next.ts'
import type { InstalledNext } from './installed-next.ts'

/** The `next.config` function form: `(phase, { defaultConfig }) => config`. */
export type NextConfigFunction<Ctx = unknown> = (
  phase: string,
  ctx: Ctx
) => NextConfig | Promise<NextConfig>

const PACKAGE = '@next-federation/next'
const ISLAND_CACHE = `${PACKAGE}/island-cache`
const IMPLEMENTATION = {
  legacy: `${ISLAND_CACHE}/legacy`,
  'cache-components': `${ISLAND_CACHE}/cache-components`,
} as const

type WebpackFn = NonNullable<NextConfig['webpack']>
type WebpackConfig = { resolve?: { alias?: unknown } }

function assertNotExternal(config: NextConfig): void {
  const external = (config.serverExternalPackages ?? []).filter(
    (name) => name === PACKAGE || name.startsWith('@next-federation/')
  )
  if (external.length > 0) {
    throw new NFError(
      'NF-002',
      `\`serverExternalPackages\` must not contain next-federation packages (found ${external
        .map((name) => `"${name}"`)
        .join(', ')}): they must be bundled so the island cache alias applies.`
    )
  }
}

/**
 * Without cacheComponents (Next 15) the adapter uses the legacy model
 * (fetch `revalidate` and tags); a config that turns on Next 15's
 * experimental equivalents would silently change how islands are cached.
 */
function assertCacheModelSupported(
  config: NextConfig,
  next: InstalledNext
): void {
  if (next.cacheComponents) return
  const experimental = (config.experimental ?? {}) as Record<string, unknown>
  const used = [
    config.cacheComponents ? '`cacheComponents`' : null,
    experimental.cacheComponents ? '`experimental.cacheComponents`' : null,
    experimental.dynamicIO ? '`experimental.dynamicIO`' : null,
  ].filter((key): key is string => key !== null)
  if (used.length === 0) return
  throw new NFError(
    'NF-002',
    `${used.join(', ')}: next-federation supports cacheComponents on Next.js 16 only (installed: ${next.version}). On Next.js 15 it uses the legacy caching model (fetch \`revalidate\` and tags): remove ${used.length === 1 ? 'this option' : 'these options'} or upgrade to Next.js 16.`
  )
}

function wrap(config: NextConfig, projectDir: string | null): NextConfig {
  assertNotExternal(config)
  const next = installedNext(projectDir)
  assertCacheModelSupported(config, next)
  const model = config.cacheComponents ? 'cache-components' : 'legacy'
  const implementation = IMPLEMENTATION[model]
  const userWebpack: WebpackFn | null | undefined = config.webpack
  const transpile = config.transpilePackages ?? []

  const webpack: WebpackFn = (webpackConfig, options) => {
    const result = (
      userWebpack ? userWebpack(webpackConfig, options) : webpackConfig
    ) as WebpackConfig
    const resolve = result.resolve ?? {}
    const alias =
      typeof resolve.alias === 'object' &&
      resolve.alias !== null &&
      !Array.isArray(resolve.alias)
        ? resolve.alias
        : {}
    // `$` makes the webpack alias exact: without it the key would also
    // rewrite `${ISLAND_CACHE}/legacy` itself.
    result.resolve = {
      ...resolve,
      alias: { ...alias, [`${ISLAND_CACHE}$`]: implementation },
    }
    return result
  }

  return {
    ...config,
    env: {
      ...config.env,
      NF_CACHE_MODEL: model,
      NF_BASE_PATH: config.basePath ?? '',
      // The version of next/link, next/navigation and next/router that
      // remote components get (@next-federation/next/components).
      NF_NEXT_VERSION: next.version,
    },
    transpilePackages: transpile.includes(PACKAGE)
      ? [...transpile]
      : [...transpile, PACKAGE],
    turbopack: {
      ...config.turbopack,
      resolveAlias: {
        ...config.turbopack?.resolveAlias,
        [ISLAND_CACHE]: implementation,
      },
    },
    webpack,
  }
}

/**
 * Required in every Next host's `next.config`. Selects the island cache
 * implementation for the host's caching model at build time (`'use cache'`
 * only compiles when `cacheComponents` is on) and passes the model and
 * `basePath` (and the installed Next version) to the adapter through `env`.
 * Every other key is kept, and an existing `webpack` function runs first.
 */
export function withNextFederation(config: NextConfig): NextConfig
export function withNextFederation<Ctx>(
  config: NextConfigFunction<Ctx>
): (phase: string, ctx: Ctx) => Promise<NextConfig>
export function withNextFederation<Ctx>(
  config: NextConfig | NextConfigFunction<Ctx>
): NextConfig | ((phase: string, ctx: Ctx) => Promise<NextConfig>) {
  // The project folder: where the calling next.config is (Next compiles a
  // next.config.ts next to it). Next's CLI never changes directory, so cwd
  // alone can be a monorepo root with another Next installed.
  const site: { stack?: string } = {}
  Error.captureStackTrace(site, withNextFederation)
  const projectDir = nextProjectDir(site.stack)
  if (typeof config === 'function') {
    return async (phase, ctx) => wrap(await config(phase, ctx), projectDir)
  }
  return wrap(config, projectDir)
}
