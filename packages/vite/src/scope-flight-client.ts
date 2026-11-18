import { createHash } from 'node:crypto'
import { FLIGHT_REGISTRY_GLOBAL } from '@next-federation/protocol'
import { PLUGIN_RSC_REQUIRE_GLOBAL } from './plugin-rsc/constants.ts'

/** Module ids of the browser flight client (`react-server-dom-webpack/client.browser`). */
export const FLIGHT_CLIENT_ID: RegExp =
  /react-server-dom-webpack-client\.browser/

/**
 * Re-points the browser flight client's page globals at this build's slot in
 * the `__nf_rsc__` registry (keyed by the build's absolute base URL), so two
 * remotes, or two builds of one remote, on one page never resolve each other's
 * client references. Order matters: `.u` before the bare name.
 */
export function scopeFlightClient(code: string, scopeKey: string): string {
  const slot = `globalThis.${FLIGHT_REGISTRY_GLOBAL}[${JSON.stringify(scopeKey)}]`
  return code
    .replaceAll(PLUGIN_RSC_REQUIRE_GLOBAL, `${slot}.require`)
    .replaceAll('__webpack_require__.u', '({}).u')
    .replaceAll('__webpack_require__', `${slot}.require`)
    .replaceAll('__webpack_chunk_load__', `${slot}.chunkLoad`)
}

/**
 * Vite's dependency optimizer does not notice plugin changes, and the dev
 * pre-bundle of the flight client has the slot key baked in, so the cache
 * folder is named after the key: a new key forces a fresh bundle.
 */
export function optimizerCacheDir(name: string, scopeKey: string): string {
  const hash = createHash('sha1').update(scopeKey).digest('hex').slice(0, 8)
  return `node_modules/.vite-nf-${name}-${hash}`
}
