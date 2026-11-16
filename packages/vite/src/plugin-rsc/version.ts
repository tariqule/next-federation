import { createRequire } from 'node:module'
import { assertPluginRscVersion } from '../checks.ts'

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
