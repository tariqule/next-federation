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
const HOSTS = [3100, 3101, 3102, 3103, 4200].map(hostOrigin)
const ROOT = import.meta.dirname

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
        base: `http://127.0.0.1:${PORT}/`,
        // Remotes `a` and `b` build from this one folder: one output folder each.
        outDir: laneOutDir(fixture.outDir ?? `dist/${NAME}`),
        // React sharing is on by default in production builds; NF_SHARE=0
        // builds the remotes without it (the e2e "share: false" runs).
        share: process.env.NF_SHARE !== '0',
        hosts: HOSTS,
        issuers: Object.fromEntries([
          ...[3100, 3102, 3101].map((p) => [
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
        },
      }),
    ],
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  }) satisfies UserConfig
}

export default islandRemoteConfig()
