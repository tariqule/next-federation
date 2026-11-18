import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { NFError } from '@next-federation/sdk'
import {
  RSC_ADVISORY,
  checkFlightClientVersion,
} from '@next-federation/protocol'
import { assertPatchedFlightClient, assertPluginRscVersion } from '../checks.ts'
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
  const check = checkFlightClientVersion(react)
  const install =
    check.status === 'affected'
      ? `react ${react} is affected by ${RSC_ADVISORY.id}, so upgrade all three to its patched version: npm install --save-exact react@${check.patched} react-dom@${check.patched} ${FLIGHT_CLIENT}@${check.patched}`
      : `npm install --save-exact ${FLIGHT_CLIENT}@${react}`
  throw new NFError(
    'NF-002',
    `${FLIGHT_CLIENT} is not installed. An island remote needs it, at exactly the version of react (${react}): ${install} (pnpm add --save-exact, yarn add --exact). Only components remotes (nextFederationComponents) can do without it.`
  )
}

/**
 * Every place a copy of `react-server-dom-webpack` that the build may use is
 * found from: this package and the project root (as for NF-002), the working
 * directory (where plugin-rsc looks for the project's own copy), and
 * `@vitejs/plugin-rsc`'s own folder, from which it resolves
 * `react-server-dom-webpack/server.edge` for the server bundle (hoisted in
 * npm or yarn workspaces, it may sit next to another copy than this package).
 * `resolveFromHere` resolves from this package (a parameter for tests).
 */
export function flightClientCheckResolvers(
  root: string,
  resolveFromHere: Resolver = createRequire(import.meta.url).resolve
): Resolver[] {
  const resolvers: Resolver[] = [
    resolveFromHere,
    createRequire(join(root, 'package.json')).resolve,
    createRequire(join(process.cwd(), 'package.json')).resolve,
  ]
  try {
    const pluginRsc = resolveFromHere('@vitejs/plugin-rsc/package.json')
    resolvers.push(createRequire(pluginRsc).resolve)
  } catch {
    // assertInstalledPluginRsc reports a missing plugin-rsc.
  }
  return resolvers
}

/** Each copy the resolvers find, with its version (null when it has none). */
function flightClientCopies(
  resolvers: ReadonlyArray<Resolver>
): { dir: string; version: string | null }[] {
  return flightClientManifests(resolvers).map((manifest) => {
    const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as {
      version?: unknown
    }
    return {
      dir: dirname(manifest),
      version: typeof version === 'string' ? version : null,
    }
  })
}

/**
 * The versions of the copies of `react-server-dom-webpack` the build may use,
 * sorted and deduplicated: `nf-build.json` records them for nf-serve.
 */
export function installedFlightClientVersions(
  root: string,
  resolvers: ReadonlyArray<Resolver> = flightClientCheckResolvers(root)
): string[] {
  const versions = flightClientCopies(resolvers).map((c) => c.version ?? '')
  return [...new Set(versions)].sort()
}

/**
 * NF-041 when a copy of `react-server-dom-webpack` that the build may use is
 * affected by GHSA-xqc2-xf4c-x3h3 or cannot be checked against it: a build
 * fails, the dev server warns.
 */
export function assertFlightClientPatched(
  root: string,
  command: 'build' | 'serve',
  resolvers: ReadonlyArray<Resolver> = flightClientCheckResolvers(root)
): void {
  for (const { dir, version } of flightClientCopies(resolvers)) {
    assertPatchedFlightClient(version ?? '', dir, command)
  }
}
