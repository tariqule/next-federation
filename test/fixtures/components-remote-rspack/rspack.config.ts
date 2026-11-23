// The components remote (client components) built with Rspack and Module
// Federation 2.0 (`@module-federation/enhanced`), not Vite: two builds (the
// browser copy and a CommonJS server copy for host SSR), then `nf-describe`
// writes the next-federation descriptor (scripts/build.ts runs all three).
// Env (set by scripts/e2e.ts):
//   PORT         listen port, baked into the public path at build time
//   NF_OUT       output folder (default dist/components)
//   NF_BUILD_ID  the build id (default: the build time, base36)
//   NF_ROUTER_RANGE  the range of @next-federation/router the build accepts
//                (the range-miss build: '>=0.99.0'; default the helper's)
// RouterLink imports next/link and next/navigation: `routerShimAliases()`
// rewires both to the router's shims, `routerSharedEntry()` shares the router.
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import {
  routerSharedEntry,
  routerShimAliases,
} from '@next-federation/router/build'
import { rspack } from '@rspack/core'
import type { Configuration } from '@rspack/core'
import { join } from 'node:path'
import { COMPONENTS_PORTS } from '../../e2e/fixtures/components-keys.ts'
import { lanePort } from '../../e2e/lane.ts'

const PORT = Number(process.env.PORT ?? lanePort(COMPONENTS_PORTS.rspack))
const buildId = (process.env.NF_BUILD_ID ??= Date.now().toString(36))
const out = join(import.meta.dirname, process.env.NF_OUT ?? 'dist/components')
/** nf-serve serves `<out>/<buildId>/client/` under the immutable `/b/<buildId>/`. */
const client = join(out, buildId, 'client')
const publicPath = `http://127.0.0.1:${PORT}/b/${buildId}/`

// Always host-provided: never bundled, read from the host's share scope.
const hostProvided = (requiredVersion: string | false) => ({
  singleton: true,
  import: false as const,
  requiredVersion,
})
const shared = {
  react: hostProvided('^19.0.0'),
  'react-dom': hostProvided('^19.0.0'),
  'react-dom/client': hostProvided('^19.0.0'),
  'react/jsx-runtime': hostProvided('^19.0.0'),
  // The host owns this context: the remote reads the host's value.
  'components-context': hostProvided(false),
  // Bundled, labelled with a version above the host's on purpose: the
  // host's router is still used whenever it satisfies the range
  // (router.spec.ts). `loaded-first` is kept (it keeps Module Federation
  // from loading every remote eagerly); it is not what makes the host win.
  '@next-federation/router': {
    ...routerSharedEntry()['@next-federation/router'],
    version: '0.99.0',
    ...(process.env.NF_ROUTER_RANGE && {
      requiredVersion: process.env.NF_ROUTER_RANGE,
    }),
  },
}
// One source with the Vite fixture: the same component, built by Rspack.
const exposes = {
  './Counter': './src/Counter.tsx',
  './RouterLink': '../components-remote/src/RouterLink.tsx',
}

const common = (): Configuration => ({
  mode: 'production',
  context: import.meta.dirname,
  entry: {},
  devtool: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // next/link and next/navigation -> the router's shims (exact matches).
    alias: routerShimAliases(),
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic' } },
          },
        },
      },
    ],
  },
})

const define = () =>
  new rspack.DefinePlugin({
    __NF_FIXTURE_BUILD__: JSON.stringify(buildId),
    __NF_BALLAST__: String(Number(process.env.NF_BALLAST ?? 0)),
  })

/** The browser build: an ES module remote entry and its chunks. */
export const browser: Configuration = {
  ...common(),
  name: 'browser',
  target: 'web',
  output: {
    path: client,
    publicPath,
    // A unique name: the host page may run other webpack/Rspack runtimes.
    uniqueName: 'components_rspack',
    clean: true,
    module: true,
    chunkFormat: 'module',
    chunkLoading: 'import',
  },
  plugins: [
    define(),
    new ModuleFederationPlugin({
      name: 'components_rspack',
      filename: 'remoteEntry.js',
      library: { type: 'module' },
      exposes,
      shared,
      shareStrategy: 'loaded-first',
      manifest: true,
      dts: false,
    }),
  ],
}

/**
 * The server build: one CommonJS file (no async chunks, so nothing is loaded
 * with `require(variable)`), next to the browser build in `client/server/`.
 * Hosts evaluate it only after checking its sha384 against the descriptor.
 */
export const server: Configuration = {
  ...common(),
  name: 'server',
  // Built after the browser copy (its `clean` empties client/).
  dependencies: ['browser'],
  target: 'async-node',
  output: {
    path: join(client, 'server'),
    publicPath: `${publicPath}server/`,
    uniqueName: 'components_rspack',
    clean: true,
    asyncChunks: false,
  },
  optimization: { splitChunks: false },
  plugins: [
    define(),
    new rspack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    new ModuleFederationPlugin({
      name: 'components_rspack',
      filename: 'remoteEntry.js',
      library: { type: 'commonjs-module' },
      exposes,
      shared,
      shareStrategy: 'loaded-first',
      manifest: true,
      dts: false,
    }),
  ],
}

export default [browser, server]
