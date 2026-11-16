import type { NextConfig } from 'next'
import { NFError } from '@next-federation/sdk'

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

function wrap(config: NextConfig): NextConfig {
  assertNotExternal(config)
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
 * `basePath` to the adapter through `env`. Every other key is kept, and an
 * existing `webpack` function runs first.
 */
export function withNextFederation(config: NextConfig): NextConfig
export function withNextFederation<Ctx>(
  config: NextConfigFunction<Ctx>
): (phase: string, ctx: Ctx) => Promise<NextConfig>
export function withNextFederation<Ctx>(
  config: NextConfig | NextConfigFunction<Ctx>
): NextConfig | ((phase: string, ctx: Ctx) => Promise<NextConfig>) {
  if (typeof config === 'function') {
    return async (phase, ctx) => wrap(await config(phase, ctx))
  }
  return wrap(config)
}
