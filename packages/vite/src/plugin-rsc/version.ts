import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { NFError } from '@next-federation/sdk'
import {
  assertPatchedFlightClient,
  assertPluginRscVersion,
  patchedFlightClientVersion,
} from '../checks.ts'
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

type Resolver = (id: string) => string

/**
 * Where Vite resolves `react-server-dom-webpack`: from this package (the
 * bootstrap's import) and from the project root (plugin-rsc's server
 * environments use the root's copy, else the one it vendors).
 */
function flightClientResolvers(root: string): Resolver[] {
  return [
    createRequire(import.meta.url).resolve,
    createRequire(join(root, 'package.json')).resolve,
  ]
}

/** The `package.json` of every copy the resolvers find (deduplicated). */
function flightClientManifests(resolvers: ReadonlyArray<Resolver>): string[] {
  const found = new Set<string>()
  for (const resolve of resolvers) {
    try {
      found.add(resolve(`${FLIGHT_CLIENT}/package.json`))
    } catch {
      // Not installed there: try the next location.
    }
  }
  return [...found]
}

/**
 * NF-002 unless `react-server-dom-webpack` (the browser flight client every
 * island bootstrap imports) resolves from this package, where Vite resolves
 * the bootstrap's import, or from the project root. It is an optional peer
 * dependency, since components remotes never use it; island remotes install
 * it at their React's exact version.
 */
export function assertFlightClientInstalled(
  root: string,
  resolvers: ReadonlyArray<(id: string) => string> = flightClientResolvers(root)
): void {
  if (flightClientManifests(resolvers).length > 0) return
  let react = '<your react version>'
  try {
    react = packageVersionReader(root)('react')
  } catch {
    // React itself is missing: Vite reports that.
  }
  const patched = patchedFlightClientVersion(react)
  const install = patched
    ? `react ${react} is affected by GHSA-xqc2-xf4c-x3h3, so upgrade all three to its patched version: npm install --save-exact react@${patched} react-dom@${patched} ${FLIGHT_CLIENT}@${patched}`
    : `npm install --save-exact ${FLIGHT_CLIENT}@${react}`
  throw new NFError(
    'NF-002',
    `${FLIGHT_CLIENT} is not installed. An island remote needs it, at exactly the version of react (${react}): ${install} (pnpm add --save-exact, yarn add --exact). Only components remotes (nextFederationComponents) can do without it.`
  )
}

/**
 * NF-041 when a copy of `react-server-dom-webpack` that Vite would use is
 * affected by GHSA-xqc2-xf4c-x3h3: a build fails, the dev server warns. Also
 * checks the copy found from the working directory, where plugin-rsc looks
 * for the project's own copy.
 */
export function assertFlightClientPatched(
  root: string,
  command: 'build' | 'serve',
  resolvers: ReadonlyArray<Resolver> = [
    ...flightClientResolvers(root),
    createRequire(join(process.cwd(), 'package.json')).resolve,
  ]
): void {
  for (const manifest of flightClientManifests(resolvers)) {
    const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as {
      version?: unknown
    }
    if (typeof version === 'string') {
      assertPatchedFlightClient(version, dirname(manifest), command)
    }
  }
}
