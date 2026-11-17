import { nextFederationIslands } from '@next-federation/vite'
import { basename, dirname, join } from 'node:path'
import { defineConfig } from 'vite'
import type { PluginOption, UserConfig } from 'vite'
import { laneName, lanePort } from '../../e2e/lane.ts'
import { reactFromPlugin, reactProbePlugin } from './fixture-plugins.ts'

const PORT = Number(process.env.PORT ?? lanePort(4100))
const NAME = process.env.NF_REMOTE ?? 'a'
// NF_LANE (see test/e2e/lane.ts): the lane's host ports and build folders.
const LANE = laneName()
const hostOrigin = (p: number) => `http://localhost:${lanePort(p)}`
// 3104, 3105: the Next 15 hosts (next15.spec.ts); 3106-3109: the
// installed-library hosts (installed-dev.spec.ts).
const INSTALLED = [3106, 3107, 3108, 3109]
const HOSTS = [3100, 3101, 3102, 3103, 3104, 3105, ...INSTALLED, 4200].map(
  hostOrigin
)
const ROOT = import.meta.dirname
// Vercel (vercel.json's buildCommand sets NF_VERCEL=1): the remote is served
// from the project's production domain, never from a generated deployment
// URL (Deployment Protection puts those behind auth). Vercel sets
// VERCEL_PROJECT_PRODUCTION_URL, without the scheme, at build time.
const VERCEL = process.env.NF_VERCEL === '1'
const vercelBase = (): string => {
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (!domain) {
    throw new Error('NF_VERCEL=1 needs VERCEL_PROJECT_PRODUCTION_URL')
  }
  return `https://${domain}/`
}
// The hosts that embed the Vercel remote: the e2e host-app in lanes a and b.
const VERCEL_HOSTS = [3100, 5100].map((p) => `http://localhost:${p}`)

export type IslandRemoteFixture = {
  /**
   * Resolve `react`, `react-dom` and `react-server-dom-webpack` from this
   * folder's `node_modules` (the old-React fixture), every environment.
   */
  reactFrom?: string
  /** Defaults to `dist/<name>` in this folder. */
  outDir?: string
}

/** `dist/<name>` becomes `dist/<lane>/<name>` outside the default lane. */
function laneOutDir(outDir: string): string {
  return LANE ? join(dirname(outDir), LANE, basename(outDir)) : outDir
}

/** The island-remote fixture config; `island-remote-old-react` reuses it. */
export function islandRemoteConfig(fixture: IslandRemoteFixture = {}) {
  const extra: PluginOption[] = []
  // The sharing e2e counts React copies at runtime; measurements run without
  // the probe's few bytes.
  if (process.env.NF_MEASURE !== '1') extra.push(reactProbePlugin())
  if (fixture.reactFrom) extra.push(reactFromPlugin(fixture.reactFrom))
  return defineConfig({
    root: ROOT,
    plugins: [
      ...extra,
      ...nextFederationIslands({
        name: NAME,
        base: VERCEL ? vercelBase() : `http://127.0.0.1:${PORT}/`,
        // Remotes `a` and `b` build from this one folder: one output folder each.
        outDir: VERCEL
          ? 'dist/vercel'
          : laneOutDir(fixture.outDir ?? `dist/${NAME}`),
        // React sharing is on by default in production builds; NF_SHARE=0
        // builds the remotes without it (the e2e "share: false" runs).
        share: process.env.NF_SHARE !== '0',
        hosts: VERCEL ? VERCEL_HOSTS : HOSTS,
        // The Vercel remote serves public islands only: it cannot reach a
        // local host's JWKS.
        issuers: VERCEL
          ? {}
          : Object.fromEntries([
              ...[3100, 3102, 3101, 3104, 3105, ...INSTALLED].map((p) => [
                hostOrigin(p),
                `${hostOrigin(p)}/api/next-federation/jwks`,
              ]),
              [
                `${hostOrigin(3103)}/base`,
                `${hostOrigin(3103)}/base/api/next-federation/jwks`,
              ],
              [hostOrigin(3999), `${hostOrigin(3999)}/jwks`],
            ]),
        islands: {
          ProductPanel: './src/islands/ProductPanel.tsx',
          Banner: './src/islands/Banner.tsx',
          Links: './src/islands/Links.tsx',
          Slow: './src/islands/Slow.tsx',
          MyOrders: { entry: './src/islands/MyOrders.tsx', private: true },
          Cart: './src/islands/Cart.tsx',
        },
      }),
    ],
    // The build id the fixture's actions report (whoami), for the skew e2e.
    define: {
      __NF_FIXTURE_BUILD__: JSON.stringify(process.env.NF_BUILD_ID ?? 'dev'),
    },
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  }) satisfies UserConfig
}

export default islandRemoteConfig()
