import { createRequire } from 'node:module'
import { NFError, logger } from '@next-federation/sdk'

/** The only `@module-federation/vite` version this package is tested against. */
export const SUPPORTED_MF_VITE_VERSION = '1.24.0'

/** The version of `@module-federation/vite` this package resolves (and wraps). */
export function installedModuleFederationViteVersion(): string {
  const require = createRequire(import.meta.url)
  const manifest = require('@module-federation/vite/package.json') as {
    version: string
  }
  return manifest.version
}

/**
 * NF-026 unless `version` is exactly the pinned `@module-federation/vite`.
 * With `NF_ALLOW_MF_VITE=1` (a CI canary job only) it logs NF-026 as a
 * warning and lets the build go on.
 */
export function assertModuleFederationViteVersion(
  version: string,
  env: Record<string, string | undefined>
): void {
  if (version === SUPPORTED_MF_VITE_VERSION) return
  const detail = `Found @module-federation/vite ${version}; @next-federation/vite supports exactly ${SUPPORTED_MF_VITE_VERSION}.`
  if (env.NF_ALLOW_MF_VITE === '1') {
    logger.warn('NF-026', `${detail} Continuing because NF_ALLOW_MF_VITE=1.`)
    return
  }
  throw new NFError('NF-026', detail)
}
