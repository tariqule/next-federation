import type { RscPluginOptions } from '@vitejs/plugin-rsc'
import type { UserConfig } from 'vite'
import type { ResolvedOptions } from '../options.ts'
import { optimizerCacheDir } from '../scope-flight-client.ts'
import { flightScopeOptimizerPlugin } from './scope.ts'

/**
 * Packages bundled into the `rsc` and `ssr` builds. Bundling them puts the
 * remote's island modules (via `@next-federation/island`) and the island
 * handler on ONE `@next-federation/server` module, so `getIdentity()` reads the
 * AsyncLocalStorage that `createIslandHandler` fills. It also makes Vite honour
 * the `react-server` export condition and `'use client'` inside these packages.
 */
export const NF_PACKAGES: RegExp = /^@next-federation\//

export type RscEntries = { rsc: string; ssr: string; client: string }

/** Options for `@vitejs/plugin-rsc`: this package's own entries, no hoistable CSS links. */
export function rscPluginOptions(entries: RscEntries): RscPluginOptions {
  // Islands must not emit `<link precedence>` tags; CSS URLs go in the
  // envelope instead (phase 0, spike vite.config.ts).
  return { entries, rscCssTransform: false }
}

/** The Vite config an island remote needs on top of plugin-rsc's own. */
export function remoteViteConfig(resolved: ResolvedOptions): UserConfig {
  const { outDir, scopeKey } = resolved
  const server = () => ({ resolve: { noExternal: [NF_PACKAGES] } })
  return {
    // plugin-rsc rejects a relative base, and hosts on other origins need
    // absolute asset URLs (finding 3).
    base: resolved.publicBase,
    cacheDir: optimizerCacheDir(resolved.name, scopeKey),
    // No @vitejs/plugin-react: Fast Refresh code cannot run in a host page
    // (finding 5). Vite's built-in oxc compiles JSX.
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'react', refresh: false },
    },
    environments: {
      client: {
        optimizeDeps: {
          rolldownOptions: { plugins: [flightScopeOptimizerPlugin(scopeKey)] },
        },
        build: {
          outDir: `${outDir}/client`,
          // Hosts import the bootstrap for its `mountIsland` export; app builds
          // drop entry exports by default (finding 7).
          rollupOptions: { preserveEntrySignatures: 'exports-only' },
        },
      },
      ssr: { ...server(), build: { outDir: `${outDir}/ssr` } },
      rsc: { ...server(), build: { outDir: `${outDir}/rsc` } },
    },
    // Vite's own CORS middleware runs before the island handler and would
    // also answer `/_nf/` requests (preflights, error responses), hiding the
    // handler's CORS in dev. `devCorsMiddleware` covers module assets only.
    server: { cors: false },
  }
}
