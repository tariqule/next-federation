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
  // envelope instead.
  return { entries, rscCssTransform: false }
}

/**
 * Dev: React, pre-bundled when the dev server starts. A remote has no HTML
 * page for Vite to scan: the bootstrap's static imports are found on the
 * first host load, before the optimizer's first run, but React and its JSX
 * runtime only once the island's client components load, after it. Vite
 * then re-optimizes and asks the page to reload over its HMR socket, which a
 * host page on another origin never hears: the page keeps the first React
 * and loads a second one (`Invalid hook call`).
 */
export const DEV_OPTIMIZE_INCLUDE: string[] = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
]

/**
 * Dev: never pre-bundled. The island package holds client components
 * (`Form`, `Link`) that plugin-rsc loads by file, and the bootstrap imports it
 * from `node_modules`, which Vite serves as files too: a pre-bundled copy,
 * made when an island's own client component imports it, would be a second
 * instance (a second bridge context) and, discovered after the first run, a
 * re-optimization with a second React. Served as files, as when linked.
 */
export const DEV_OPTIMIZE_EXCLUDE: string[] = ['@next-federation/island']

/** The Vite config an island remote needs on top of plugin-rsc's own. */
export function remoteViteConfig(
  resolved: ResolvedOptions,
  user: UserConfig = {}
): UserConfig {
  const { outDir, scopeKey } = resolved
  const server = () => ({ resolve: { noExternal: [NF_PACKAGES] } })
  return {
    // plugin-rsc rejects a relative base, and hosts on other origins need
    // absolute asset URLs.
    base: resolved.publicBase,
    cacheDir: optimizerCacheDir(resolved.name, scopeKey),
    // No @vitejs/plugin-react: Fast Refresh code cannot run in a host page.
    // Vite's built-in oxc compiles JSX.
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'react', refresh: false },
    },
    environments: {
      client: {
        optimizeDeps: {
          include: DEV_OPTIMIZE_INCLUDE,
          exclude: DEV_OPTIMIZE_EXCLUDE,
          rolldownOptions: { plugins: [flightScopeOptimizerPlugin(scopeKey)] },
        },
        build: {
          outDir: `${outDir}/client`,
          // Hosts import the bootstrap for its `mountIsland` export; app builds
          // drop entry exports by default.
          rollupOptions: { preserveEntrySignatures: 'exports-only' },
        },
      },
      ssr: { ...server(), build: { outDir: `${outDir}/ssr` } },
      rsc: { ...server(), build: { outDir: `${outDir}/rsc` } },
    },
    // Vite's own CORS middleware runs before the island handler and would
    // also answer `/_nf/` requests (preflights, error responses), hiding the
    // handler's CORS in dev. `devCorsMiddleware` covers module assets only.
    server: {
      cors: false,
      // Vite 8 can forward browser console output to the dev server's
      // terminal: for a remote that is every host page's console. Off,
      // unless the remote's own config sets it.
      ...(user.server?.forwardConsole === undefined
        ? { forwardConsole: false }
        : {}),
    },
  }
}
