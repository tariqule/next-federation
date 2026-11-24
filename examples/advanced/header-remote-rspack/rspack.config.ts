// The header remote: React client components built with Rspack and Module
// Federation 2.0 (@module-federation/enhanced), not Vite. Two builds: the
// browser copy, and a CommonJS server copy that Next.js hosts evaluate to
// server-render the components (only after verifying the signed
// descriptor). scripts/build.ts runs both, then nf-describe.
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import {
  routerSharedEntry,
  routerShimAliases,
} from '@next-federation/router/build'
import { rspack } from '@rspack/core'
import type { Configuration } from '@rspack/core'
import { join } from 'node:path'

// This remote's public URL. Locally 127.0.0.1:13404; set HEADER_ORIGIN in a
// deployment.
const ORIGIN = process.env.HEADER_ORIGIN ?? 'http://127.0.0.1:13404'
const buildId = (process.env.NF_BUILD_ID ??= new Date()
  .toISOString()
  .replace(/[:.]/g, '-'))
// nf-serve serves dist/<buildId>/client/ under the immutable /b/<buildId>/.
const client = join(import.meta.dirname, 'dist', buildId, 'client')
const publicPath = `${ORIGIN}/b/${buildId}/`

// Host-provided: never bundled, always the host's module. React itself, and
// the two React contexts the host owns (one copy, or the remote would read
// a context nobody provides).
const host = (requiredVersion: string | false) => ({
  singleton: true,
  import: false as const,
  requiredVersion,
})
const shared = {
  react: host('^19.0.0'),
  'react-dom': host('^19.0.0'),
  'react-dom/client': host('^19.0.0'),
  'react/jsx-runtime': host('^19.0.0'),
  'example-cart-context': host(false),
  'example-session-context': host(false),
  // Bundled (not a singleton): the host's copy when it passes one that
  // satisfies ^2.0.0, else this build's own copy (the fallback copy).
  'example-design-system': { singleton: false, requiredVersion: '^2.0.0' },
  // Links (Header's next/link, rewired below): what the rewired import runs
  // on, bundled. The host's copy when it is in the range, else this build's
  // own (plain links).
  ...routerSharedEntry(),
}
const exposes = {
  './Header': './src/Header.tsx',
  './MiniCart': './src/MiniCart.tsx',
  './SearchBox': './src/SearchBox.tsx',
  './AddToCart': './src/AddToCart.tsx',
}

const common = (): Configuration => ({
  mode: 'production',
  context: import.meta.dirname,
  entry: {},
  devtool: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // next/link and next/navigation -> shims that navigate with the host's
    // router (exact matches).
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
  plugins: [new rspack.DefinePlugin({ __BUILD_ID__: JSON.stringify(buildId) })],
})

export const browser: Configuration = {
  ...common(),
  name: 'browser',
  target: 'web',
  output: {
    path: client,
    publicPath,
    // The host page may run other webpack or Rspack runtimes.
    uniqueName: 'header',
    clean: true,
    module: true,
    chunkFormat: 'module',
    chunkLoading: 'import',
  },
  plugins: [
    ...common().plugins!,
    new ModuleFederationPlugin({
      name: 'header', // the container name the hosts expect
      filename: 'remoteEntry.js',
      library: { type: 'module' },
      exposes,
      shared,
      // Keeps Module Federation from initialising every remote eagerly. Not
      // what makes the host's router win: the host registers its router as
      // loaded, and its runtime picks it when it is in the range.
      shareStrategy: 'loaded-first',
      manifest: true,
      dts: false,
    }),
  ],
}

// One CommonJS file (no async chunks): hosts resolve no Node modules for
// remote code, and check its sha384 before evaluating it.
export const server: Configuration = {
  ...common(),
  name: 'server',
  // Built after the browser copy (whose `clean` empties client/).
  dependencies: ['browser'],
  target: 'async-node',
  output: {
    path: join(client, 'server'),
    publicPath: `${publicPath}server/`,
    uniqueName: 'header',
    clean: true,
    asyncChunks: false,
  },
  optimization: { splitChunks: false },
  plugins: [
    ...common().plugins!,
    new rspack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    new ModuleFederationPlugin({
      name: 'header',
      filename: 'remoteEntry.js',
      library: { type: 'commonjs-module' },
      exposes,
      shared,
      // Keeps Module Federation from initialising every remote eagerly. Not
      // what makes the host's router win: the host registers its router as
      // loaded, and its runtime picks it when it is in the range.
      shareStrategy: 'loaded-first',
      manifest: true,
      dts: false,
    }),
  ],
}

export default [browser, server]
