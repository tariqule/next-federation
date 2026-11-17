import { createRequire } from 'node:module'
import { join } from 'node:path'
import { NFError } from '@next-federation/sdk'
import { assertPluginRscVersion } from '../checks.ts'
import { packageVersionReader } from '../share.ts'

export { SUPPORTED_PLUGIN_RSC_VERSION } from './constants.ts'

/** The version of the plugin-rsc this package itself resolves (and wraps). */
export function installedPluginRscVersion(): string {
  const require = createRequire(import.meta.url)
  const manifest = require('@vitejs/plugin-rsc/package.json') as {
    version: string
  }
  return manifest.version
}

/** NF-025 unless the resolved plugin-rsc is the pinned version. */
export function assertInstalledPluginRsc(
  env: Record<string, string | undefined>
): void {
  assertPluginRscVersion(installedPluginRscVersion(), env)
}

const FLIGHT_CLIENT = 'react-server-dom-webpack'

/**
 * NF-002 unless `react-server-dom-webpack` (the browser flight client every
 * island bootstrap imports) resolves from this package, where Vite resolves
 * the bootstrap's import, or from the project root. It is an optional peer
 * dependency, since components remotes never use it; island remotes install
 * it at their React's exact version.
 */
export function assertFlightClientInstalled(
  root: string,
  resolvers: ReadonlyArray<(id: string) => string> = [
    createRequire(import.meta.url).resolve,
    createRequire(join(root, 'package.json')).resolve,
  ]
): void {
  for (const resolve of resolvers) {
    try {
      resolve(`${FLIGHT_CLIENT}/package.json`)
      return
    } catch {
      // Try the next location.
    }
  }
  let react = '<your react version>'
  try {
    react = packageVersionReader(root)('react')
  } catch {
    // React itself is missing: Vite reports that.
  }
  throw new NFError(
    'NF-002',
    `${FLIGHT_CLIENT} is not installed. An island remote needs it, at exactly the version of react (${react}): npm install --save-exact ${FLIGHT_CLIENT}@${react} (pnpm add --save-exact, yarn add --exact). Only components remotes (nextFederationComponents) can do without it.`
  )
}
