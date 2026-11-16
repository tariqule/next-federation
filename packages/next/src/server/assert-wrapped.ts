import { NFError } from '@next-federation/sdk'

export type CacheModel = 'legacy' | 'cache-components'

const MISSING =
  'Wrap your next.config with `withNextFederation()` from `@next-federation/next/config`.'

// `process.env.NF_*` must stay written out in full: Next inlines `env` values
// set by `withNextFederation` by matching these exact expressions.

/** The host's caching model, set at build time by `withNextFederation`. NF-017 without it. */
export function cacheModel(): CacheModel {
  const model = process.env.NF_CACHE_MODEL
  if (model === 'legacy' || model === 'cache-components') return model
  throw new NFError(
    'NF-017',
    model === undefined
      ? MISSING
      : `Unexpected NF_CACHE_MODEL "${model}". ${MISSING}`
  )
}

/** The host's `basePath` (`''` when none). NF-017 when the wrapper is missing. */
export function hostBasePath(): string {
  cacheModel()
  return process.env.NF_BASE_PATH ?? ''
}
