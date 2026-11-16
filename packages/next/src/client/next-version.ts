import { NFError } from '@next-federation/sdk'

/**
 * The host's Next.js version, set at build time by `withNextFederation`:
 * remote components check their `requiredVersion` of `next/*` against it.
 * NF-017 when the wrapper is missing.
 */
export function hostNextVersion(): string {
  // Written out in full: Next inlines `env` values by this exact expression.
  const version = process.env.NF_NEXT_VERSION
  if (version) return version
  throw new NFError(
    'NF-017',
    'Wrap your next.config with `withNextFederation()` from `@next-federation/next/config`: remote components need the host Next.js version it records.'
  )
}
