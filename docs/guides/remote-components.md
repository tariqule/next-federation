# Remote components

Runnable example: [examples/components-remote](../../examples/components-remote) (shared context:
[examples/cart-context](../../examples/cart-context))

A remote component is a remote's client component, loaded at runtime through the Module
Federation 2.0 runtime and rendered inside the host's own React tree. The component runs on the
host's React, reads the host's React context, and can take any props, including functions and
children. Next.js hosts (App Router and Pages Router) **server-render** it and the browser hydrates
it. SPA hosts render it in the browser.

## Islands or remote components?

Both come from a remote: a separate app that another team builds and deploys. The difference is
where the remote's code runs. An island runs on the remote's server, and the host embeds the result.
A remote component is code the remote ships that runs inside the host app.

| | Islands | Remote components |
| --- | --- | --- |
| Where the remote's code runs | On the remote's own server | Inside the host app (browser and host server) |
| What the remote ships | Server-rendered HTML + its own React tree | A client component module |
| React | The remote's own (shared between islands when versions match) | Always the host's |
| Host React context | Does not cross into the island | Readable (shared context modules) |
| Props | Plain JSON | Anything a client component takes |
| Server rendering | Always, on the remote | On the host, for verified builds only |
| Remote server code in the host process | Never | Yes, for verified builds (see Integrity) |
| Remote framework | Anything that serves the island protocol | Any Module Federation 2.0 build: `nextFederationComponents` (Vite), or Rspack/webpack + `nf-describe` |

Use islands when the remote must stay isolated, or owns its data fetching. Use remote components
for interactive pieces that must feel like part of the host: they share its React, context,
router and event handlers.

## Start from create-vite

`npm create vite@latest widgets -- --template react-ts` gives you a Vite 8 project with things a
components remote does not need. Make these edits:

1. **`@vitejs/plugin-react`:** remove it, or exclude your exposed files from it
   (`react({ exclude: [/src\/Cart\.tsx$/] })`). An exposed module compiled with Fast Refresh fails
   the build with `NF-002`, because a host page has no Vite preamble. Vite compiles JSX without the
   plugin.
2. **`index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/assets/`:** the remote
   build only reads the files in `exposes`, so the scaffold's page is unused. Delete them, or keep
   the app running on its own with a second Vite config
   ([Keeping a standalone app](#keeping-a-standalone-app)). Exposed modules must not import from
   them.
3. **`vite.config.ts`:** replace it with the `nextFederationComponents` config below, or, to keep
   the standalone app, leave it as it is and put the remote's config in `vite.remote.config.ts`.
4. **Build script:** `"build": "vite build"` and `"start": "nf-serve --dir dist --port 4110"`
   (with two configs: `"build:remote": "vite build --config vite.remote.config.ts"` and
   `"start:remote"`, see below).
   The scaffold's `tsc -b && vite build` still works as a type check when every file in `src`
   compiles. `vite preview` does not serve a remote: use `nf-serve`.
5. **Dependencies:** `@next-federation/vite` and `@next-federation/server` as dev dependencies. If an
   exposed module imports `next/link`, add `next` as a dev dependency too and list it with `shared: { 'next/link': {} }`. Pin `react` and `react-dom` to one exact version
   ([React versions](../../README.md#status-and-compatibility)).
6. **oxlint** (the `lint` script and `.oxlintrc.json`) is independent of the build; keep it or
   delete it. Its `react/only-export-components` rule exists for Fast Refresh, which exposed modules
   do not use.
7. **TypeScript: `types: true` needs TypeScript 5 or 6.** Any version installs, and without
   `types` the version does not matter. create-vite installs TypeScript 7; with it the build
   succeeds, warns `NF-002` naming `npm install -D typescript@6`, and publishes no types. Pin
   `typescript@~6` in a remote that publishes types. The plugin
   reads the project's root `tsconfig.json`; create-vite's references-only file works as it is.

## Remote: build it

```ts
// vite.config.ts of the remote
import { nextFederationComponents } from '@next-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    nextFederationComponents({
      name: 'shop', // the Module Federation container name (a JS identifier)
      base: 'https://shop.example.com/',
      exposes: { './Cart': './src/Cart.tsx' },
      // Modules shared with the host, besides React (see Sharing modules):
      shared: ['@acme/host-context'],
    }),
  ],
})
```

`vite build` writes `dist/<buildId>/`:

- `client/`: the browser build (`remoteEntry.js`, `mf-manifest.json`, chunks) **and** the server
  copy (`remoteEntry.ssr.js` and its `.cjs` chunks), served under the immutable
  `https://shop.example.com/b/<buildId>/`, and, with `types: true`, `@mf-types/`: the exposed
  modules' type declarations and their index (see [Types](#types)).
- **`nf-serve` serves the files above to anyone**, at `/b/<buildId>/…`, with
  `Access-Control-Allow-Origin: *`. `client/` also holds build bookkeeping: `.vite/manifest.json`,
  `.vite/mf-preload.json` and `mf-stats.json` (relative source paths and shared package versions, no
  code). Nothing reads them at runtime, and `nf-serve` answers `404` for them (any dot folder or
  file, and `mf-stats.json`). On another static host, leave them out of the upload or block them.
  Never put anything in `client/` that you would not publish.
- `nf-components.json`: the build descriptor: `buildId`, the manifest URL, the **sha384 of every
  server file** and the **browser files** of each exposed module (its stylesheets and JS chunks, as
  absolute `/b/<buildId>/…` URLs) and, with types, the URL and sha384 of the declarations index,
  plus its digest and, when signed, an ES256 JWS over all of it.
- `nf-build.json`: what `nf-serve` reads.
- `nf-shared-usage.json`: which exposed modules import which shared module. It is signed into
  the descriptor's `shared` field, and `nf-describe` reads it when it describes the build again.

`react`, `react-dom`, `react-dom/client` and `react/jsx-runtime` are always host-provided
(`import: false`). The build id is `buildId`, `NF_BUILD_ID`, or the build time.

Serve it with `nf-serve --dir dist --port 4110`: `/_nf/components.json` is the current build's
descriptor (`Cache-Control: no-store`), `/b/<buildId>/…` serves every build kept by retention, and
a retired build answers `410` (`NF-023`), exactly as for islands.

The build fails with `NF-002` when an exposed module contains Fast Refresh code (a host page has no
Vite preamble), so leave `@vitejs/plugin-react` out of this config. A standalone app of the same
project keeps the plugin in its own config (next section).

### Keeping a standalone app

`nextFederationComponents` applies to the whole Vite project it is in: `react`, `react-dom` and
every `shared` module become host-provided for every module, and `vite build` builds only the
exposed modules (no `index.html`). A page of that project cannot run on its own: its dev server
fails with `createContext is not a function` (or `module is not defined` with `shared: {}`), and the
dev server logs one `NF-002` warning when a browser opens a page of it. To keep the app working as
an app (a dev playground, or a product of its own), give the remote its own Vite config in the same
project:

```ts
// vite.config.ts: the standalone app (create-vite's config, unchanged)
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [react()] })
```

```ts
// vite.remote.config.ts: the components remote (no @vitejs/plugin-react)
import { nextFederationComponents } from '@next-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    nextFederationComponents({
      name: 'widgets',
      base: 'https://widgets.example.com/',
      outDir: 'dist-remote',
      exposes: { './Counter': './src/components/Counter.tsx' },
      shared: { '@acme/host-context': { requiredVersion: '^1.0.0' } },
    }),
  ],
})
```

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "dev:remote": "vite --config vite.remote.config.ts",
    "build:remote": "vite build --config vite.remote.config.ts",
    "start:remote": "nf-serve --dir dist-remote --port 4110"
  }
}
```

The app and the remote build the same component files: `npm run dev` and `npm run build` are the
app (its own React, `dist/`), `npm run build:remote` and `npm run start:remote` are the remote
(host-provided React, `dist-remote/`). Use a separate `outDir` so neither build empties the other's
folder.

`@module-federation/vite` is pinned to exactly **1.24.0** (`NF-026` otherwise; `NF_ALLOW_MF_VITE=1`
for a canary job only).

## Remotes built with Rspack or webpack

Any Module Federation 2.0 remote that emits `mf-manifest.json` works, built with
`@module-federation/enhanced`. The e2e suite runs one built with Rspack 2.3.0 and
`@module-federation/enhanced` 2.9.3 against App Router, Pages Router and SPA hosts
(`test/fixtures/components-remote-rspack`). You make two builds (the browser copy and a CommonJS
server copy for host SSR), then `nf-describe` (in `@next-federation/server`) writes the descriptor.

**webpack is documented but untested**: only the Rspack setup below runs in the e2e suite. The
webpack equivalent (same options, `@module-federation/enhanced/webpack` and webpack's
`LimitChunkCountPlugin`) is expected to work the same way, but no test proves it.

```ts
// rspack.config.ts of the remote (webpack: the same, with
// `@module-federation/enhanced/webpack` and webpack's LimitChunkCountPlugin)
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import { rspack } from '@rspack/core'
import type { Configuration } from '@rspack/core'
import { join } from 'node:path'

const buildId = process.env.NF_BUILD_ID ?? Date.now().toString(36)
const client = join(import.meta.dirname, 'dist', buildId, 'client')
// Absolute and immutable per build: nf-serve serves client/ under /b/<buildId>/.
const publicPath = `https://shop.example.com/b/${buildId}/`

// Host-provided, never bundled: always these four React modules, plus any
// module whose instance the host owns (a context module).
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
  '@acme/host-context': host(false),
}
const exposes = { './Cart': './src/Cart.tsx' }
const common: Configuration = {
  mode: 'production',
  entry: {},
  resolve: { extensions: ['.tsx', '.ts', '.js'] },
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
}

export default [
  {
    ...common,
    name: 'browser',
    target: 'web',
    output: {
      path: client,
      publicPath,
      uniqueName: 'shop', // the host page may run other webpack runtimes
      clean: true,
      module: true,
      chunkFormat: 'module',
      chunkLoading: 'import',
    },
    plugins: [
      new ModuleFederationPlugin({
        name: 'shop', // the container name (a JS identifier)
        filename: 'remoteEntry.js',
        library: { type: 'module' },
        exposes,
        shared,
        manifest: true,
        dts: false,
      }),
    ],
  },
  {
    ...common,
    name: 'server',
    // Built after the browser copy (its `clean` empties client/).
    dependencies: ['browser'],
    target: 'async-node',
    output: {
      path: join(client, 'server'),
      publicPath: `${publicPath}server/`,
      uniqueName: 'shop',
      clean: true,
      // One file: hosts resolve no Node modules (fs, vm) for remote code.
      asyncChunks: false,
    },
    optimization: { splitChunks: false },
    plugins: [
      new rspack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      new ModuleFederationPlugin({
        name: 'shop',
        filename: 'remoteEntry.js',
        library: { type: 'commonjs-module' },
        exposes,
        shared,
        manifest: true,
        dts: false,
      }),
    ],
  },
] satisfies Configuration[]
```

Then describe the build and serve it. Set `NF_COMPONENTS_SIGNING_KEY` for the `nf-describe` run
too: without it the descriptor is unsigned (see [Signing](#key-generation)).

```sh
NF_BUILD_ID=v1 rspack build
nf-describe --dir dist/v1 --ssr-entry server/remoteEntry.js
nf-serve --dir dist --port 4110
```

`nf-describe --dir <build folder>` reads `<build folder>/client/mf-manifest.json` and:

- records the server entry in the manifest (`metaData.ssrRemoteEntry`, `type: 'commonjs-module'`;
  Rspack and webpack manifests never name one), which is how a host's server finds it;
- hashes the manifest and every file of the server graph, and fails (`NF-002`) when a server file
  requires a module hosts never provide (an async-chunk server build loads its chunks with `fs` and
  `vm`: build it as one file, as above);
- writes `nf-components.json` (exactly what `nextFederationComponents` writes, browser assets
  included, signed when `NF_COMPONENTS_SIGNING_KEY` holds the private JWK; an unsigned build with
  `NODE_ENV=production` is a warning) and `nf-build.json`.

The descriptor's `shared` field comes from the manifest's `shared` list: every module but React,
its `requiredVersion`, and `fallback` for a non-singleton (bundled) share (never for a `react`,
`react-dom` or `next` module, which hosts always provide). Without the Vite plugin's
`nf-shared-usage.json` there is no per-expose list, so a host checks every exposed module against
every host-provided module the build shares (`NF-036`).

With `--types` (off by default, as the Vite plugin's `types` option), it writes
`client/@mf-types/index.json` (every `.d.ts` file in `client/@mf-types/` with its sha384) and signs
that one file in the descriptor's `types` field (see [Types](#types)); `--types` on a build without
that folder fails (`NF-002`). Without `--types` a `client/@mf-types/` folder is left as it is,
unsigned, and hosts download no types for the build.

It never reads or writes a build file through a symlink, and refuses server files that resolve
outside the build folder (`NF-002`).

**Run `nf-describe` before you upload the build** (for example to a CDN): it rewrites
`client/mf-manifest.json`, whose sha384 is in the descriptor. A copy of the manifest uploaded
earlier fails the digest check, and hosts then render the build in the browser only (`NF-027`).

The build id is the folder name (`--build-id` otherwise); the public URL is the manifest's absolute
`publicPath` (`--base` when it is `auto`) and must contain the build id. `--no-ssr` describes a
browser-only build. `--types` signs the build's declarations. Describing a build again keeps its
build time.

`nf-describe --dir <build folder> --verify` checks a described build before you ship it
(`NF-027` otherwise): the digest covers the payload (assets included), the JWS signs exactly that
payload, the assets are the ones `mf-manifest.json` lists, a signed types index matches
`client/@mf-types/index.json` and lists exactly the declaration files there (a folder the
descriptor does not sign, as in a build described without `--types`, is not checked), and every
server file still matches its sha384. With `--public-key <public JWK or file>` (repeatable) it also verifies the ES256
signature, as hosts do; **without one the signature is not checked**, and the output says so.

Run the installed `nf-describe` binary directly (`node_modules/.bin/nf-describe` or a `package.json`
script). `npx` can lose the flags (one test saw `npx nf-describe ... --verify` re-describe the build
instead of verifying it), so check that the output says what you asked for.

## Host: configure the remote

Put the federation in its own file with no Next.js imports, so `nf-types` can load it
([Types](#types)); `lib/federation.ts` imports it ([Getting started](getting-started-app-router.md#3-define-the-federation)).

```ts
// lib/federation.config.ts
import { defineFederation } from '@next-federation/core'

export const federation = defineFederation({
  remotes: {
    shop: {
      origin: process.env.SHOP_ORIGIN ?? 'https://shop.example.com',
      components: {
        // The public JWK printed by "Key generation" below (see Integrity):
        ssr: { publicKeys: [JSON.parse(process.env.NF_COMPONENTS_PUBLIC_KEY!)] },
        // descriptor: 'https://shop.example.com/_nf/components.json' (default)
        // revalidate: 60      seconds the descriptor is cached (default islands.revalidate)
        // maxBuilds: 5        distinct builds a process keeps loaded
      },
    },
  },
})
```

Bind the exposed component in a `'use client'` module. Next.js hosts import `createRemoteComponent`
from the entry for their router, which also provides the host's `next/*` modules (see
[Sharing modules](#sharing-modules)): `@next-federation/next/components` (App Router) or
`@next-federation/next/pages/components` (Pages Router). An SPA imports it from
`@next-federation/react/components`.

```tsx
'use client'
import * as HostContext from '@acme/host-context'
import { createRemoteComponent } from '@next-federation/next/components'

export const Cart = createRemoteComponent<{ items: number }>({
  expose: './Cart',
  // Modules this host provides to the remote (its `shared` list):
  shared: { '@acme/host-context': { version: '1.0.0', module: HostContext } },
  fallback: <p>Loading the cart…</p>,
  errorFallback: <p>Cart unavailable</p>,
})
```

`fallback` shows while the component loads, and in the server HTML of a component the browser
renders (an unverified build, or one that threw on the server). `errorFallback` shows when it
failed: the remote could not be reached (`descriptor` is `null`), its module did not load after the
retries, a shared module it needs is missing (`NF-036`), or it threw while rendering (`NF-040`).
Without `errorFallback`, `fallback` is used for both, so word it for both ("Cart unavailable" reads
wrong while the cart is loading). Both can also be passed per use, as props of the component.

### App Router

```tsx
import { getComponentDescriptor } from '@next-federation/next/server'
import { federation } from '@/lib/federation'
import { Cart } from '@/lib/cart'

export default async function Page() {
  const descriptor = await getComponentDescriptor(federation, 'shop')
  return <Cart descriptor={descriptor} items={3} />
}
```

The descriptor names the build this render uses and is passed as a prop, so the browser loads
exactly that build from `/b/<buildId>/`, even if a newer build went live in between (no hydration
mismatch during a deploy).

With `cacheComponents`, two shapes are supported:

- **Cached** (default): the descriptor is read through `'use cache'` with
  `cacheLife({ revalidate: components.revalidate, … })` (at least minutes of `expire`), so the page
  can be prerendered static with the remote's markup in it. If the remote is down, the failure is
  cached for a few seconds (still in the static shell, so the page stays static and is regenerated
  soon) and the last known build or the fallback renders. Put the component inside `<Suspense>`.
- **Per request**: `getComponentDescriptor(federation, 'shop', { dynamic: true })` inside
  `<Suspense>`: a partial prerender (the shell is static, the component streams in). Outside
  `<Suspense>` Next fails the build, as for any uncached data.

Without `cacheComponents` the descriptor is fetched with `next: { revalidate }`; `dynamic: true`
uses `cache: 'no-store'`. The library keeps no in-process cache of its own (it would hide the fetch
from Next) and reads no wall clock.

### Pages Router

```tsx
// pages/cart.tsx
import type { GetServerSideProps } from 'next'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { federation } from '../lib/federation.config'
import { Cart } from '../lib/cart'

type Props = { descriptor: RemoteComponentDescriptor | null }

export const getServerSideProps: GetServerSideProps<Props> = async () => ({
  props: { descriptor: await getComponentDescriptor(federation, 'shop') },
})

export default function Page({ descriptor }: Props) {
  return <Cart descriptor={descriptor} items={3} />
}
```

`getStaticProps` works the same way. In `getServerSideProps` the descriptor is fetched on every
request: Next's `next: { revalidate }` fetch cache exists only in the App Router. The Pages Router waits for Suspense during server rendering, so
the component's HTML is always inline. `preloadRemoteComponent(descriptor, './Cart')` (or
`Cart.preload(descriptor)`) loads the module ahead of rendering in `getServerSideProps`.

### Mixed-router hosts

A Next.js host can have App Router routes (`app/`) and Pages Router routes (`pages/`) at once. Use
each router's own entry point on its own routes, as above: `@next-federation/next/components` and
`@next-federation/next/server` under `app/`, `@next-federation/next/pages/components` and
`@next-federation/next/pages/server` under `pages/`. Nothing else changes, and both routers
server-render remote components.

**Links between the two routers reload the page.** A link from an `app/` route to a `pages/` route
(or the other way) is a full page load, not a client-side navigation, for a plain `<Link>` and for a
remote `next/link` (a components remote's link) alike. This is how Next.js handles links between its
two routers, with or without next-federation. The navigation still arrives; it only costs a reload.
Client-side navigation and prefetching work inside each router.

**In `next dev`, a Pages Router page that links to an App Router route logs a `404` in the browser
console** (`Failed to load resource: the server responded with a status of 404`), seen when a remote
`next/link` on a `pages/` route pointed at an `app/` route. A production run (`next start`) logs
nothing for the same navigation. It is a dev-time message about the prefetch of a route the other
router owns.

The two routers run two Reacts in one server process: the App Router uses Next's vendored copy,
the Pages Router the one in `node_modules`. A remote component must render on the React of the
route that renders it, so each router layer has its own remote component runtime:

- its own Module Federation host instance;
- its own copy of each remote build's server code, fetched and checked against the build's sha384
  digests in that layer;
- its own copy of the globals that copy keeps its Module Federation state in. A Vite remote's
  share cache and init state (`__mf_module_cache__`, `__mf_init__…`) live in the layer, never on
  the process-wide `globalThis`, so a remote copy reads only its own layer's React and host
  modules. A Rspack or webpack remote bundles its own Module Federation runtime: its registry
  (`__FEDERATION__`) is kept per layer too, so each layer's copy finds its own instance and share
  scope.

Two limits remain. First, this isolates cooperating builds; it is not a sandbox. A verified remote
runs with the host process's full rights, and its code can still reach the real global object (for
example through `global` or `Function('return this')()`). The host's own Module Federation
instances, one per layer, stay visible process-wide in the runtime's registry
(`__FEDERATION__.__INSTANCES__` and `__SHARE__`). Second, the server loader keeps a build apart per
layer only when it knows how that build keeps its state: `@module-federation/vite` 1.24.0 builds,
and `@module-federation/enhanced` 2.9.2 and 2.9.3 builds whose server entry bundles its own runtime (the
`metaData.pluginVersion` of the build's `mf-manifest.json`). Any other build (an unlisted one) may
leave state on the real global object that every other unlisted build shares. So all unlisted builds
server-render in one layer per process only: the first layer in which one of them evaluated. Every
other layer renders them in the browser only. Once a layer has them, the others decide right after
the build's manifest, before any server code is fetched; `NF-028` is logged once per build and
layer, and that layer never fetches the build's server code again.

A build whose `mf-manifest.json` lists `remotes` of its own never server-renders, in any host. Its
nested remotes would load through the Module Federation runtime's own Node loader, outside the
server loader: unverified (no sha384 check) and on the real global object. So it renders in the
browser only (`NF-028`, logged once). The same holds for a build without a manifest the server loader could
check: a descriptor whose `manifest` is the remote entry itself, or one that does not answer JSON.
The host decides this when it fetches the descriptor (it reads the build's manifest, checked against
its sha384), so such a build never defers a static page or reaches the server loader. The server
loader checks every JSON response of the build again, whatever its file name.

What this costs and changes:

- A mixed host loads each remote build up to twice, once per layer, and `maxBuilds` applies per
  layer.
- A remote's server entry initialises in one layer at a time, never in both at once. A layer waits
  at most 10 s for the other layer's initialisation. After that, the load fails and is retried
  after the cooldown, so the remote renders in the browser only meanwhile.
- A satisfying host copy of a `fallback: true` shared module is seeded into each layer's own cache,
  so each layer's routes get their own copy of the module.
- When a layer's cache holds another copy of a `fallback: true` module than the host's (a bundled
  copy cached before the host registered its own, or a module registered again with another
  object), that layer moves to a new scope: a clean cache, and the remote's server code is
  evaluated again. Every expose then loads again in the new scope, so module state (a module-level
  store, for example) is not shared with the copies loaded before. A layer moves at most 4 times;
  after that, such a build renders in the browser only in that layer (`NF-028`, logged once). A
  timed-out load keeps the scope.
- Register shared modules in each router: `registerSharedModules` in the root layout for `app/`
  routes and in `_app` for `pages/` routes.

`next dev --webpack` re-creates the host's server modules when it compiles another route. Each
re-created runtime counts as a new layer with an empty share cache: it loads the remote's server
code again, so remote components keep server-rendering on the current modules. A build the server
loader cannot keep apart (see above) renders in the browser only after such a reload, until the
dev server restarts. The dev server also keeps the earlier runtimes' loaded builds until it
restarts. Production builds and `next dev` with Turbopack create each runtime once.

### SPA

```tsx
import { fetchDescriptorInBrowser } from '@next-federation/react/components'

const descriptor = await fetchDescriptorInBrowser(
  'https://shop.example.com/_nf/components.json'
)
root.render(<Cart descriptor={descriptor} items={3} />)
```

An SPA never runs remote server code: `fetchDescriptorInBrowser` always returns `ssr: null`.

## Integrity (server rendering)

Server rendering runs the remote's server code **inside the host's server process**, with access to
its environment and secrets. The host therefore evaluates it only for a build it can verify, and
renders every other build in the browser only (secure by default, `NF-028` logged once per build):

1. **Signed descriptor** (recommended): the remote build signs its descriptor with an ES256 key.
2. **Pinned builds**: the host lists allowed `buildId → digest` pairs, for teams that deploy host
   and remote together.
3. **`integrity: 'unsafe-dev'`**: trusts the descriptor as served. Allowed only when `NODE_ENV` is
   `development` or `test` (`NF-002` at `defineFederation` otherwise).

Optional checks: `components.name` (the expected container name; a descriptor naming another is
refused) and `components.ssr.maxAge` (seconds a signed build stays acceptable after its build time,
the signed `iat`; it bounds signed builds only, never a pinned or `unsafe-dev` one). Whatever the
policy, a descriptor whose `digest` field is not the digest of its payload, or whose `iat` is more
than 60 seconds in the future, is refused (`NF-027`, browser only).

**Pass only the value of `getComponentDescriptor`** (or `fetchDescriptorInBrowser` in an SPA) as
the `descriptor` prop; never build one by hand or from request data. The server does not trust a
prop: `verifyComponentDescriptor` records the digest of every descriptor it verified in a
process-wide registry (with how it was trusted), and the server loader evaluates a build only when its descriptor is in that
registry or re-verifies there and then, from the carried JWS or a pin, against the keys
`defineFederation` registered (for example a descriptor served from a shared cache after a
restart). When `defineFederation` registers a changed policy for a remote (a dev reload), the
builds verified under the old one are dropped. Anything else renders in the browser only (`NF-028`). The integrity map of a build that
is loaded is never replaced.

In every case, each server file the host fetches (the manifest, `remoteEntry.ssr.js`, every chunk)
must match the sha384 in the verified descriptor **before anything is evaluated**; a file that is
missing from the descriptor or does not match is never run, and that build renders in the browser
only (`NF-027`).

**Integrity is the only security boundary.** The loader's `require` resolves only the remote's
own files and the host's `@module-federation/runtime` (`NF-030` otherwise), but that is a guard
against a second React, not a sandbox: verified remote code runs with the host process's full
authority (`process`, `globalThis`, dynamic `import()` are all reachable). Server-render only
remotes you would deploy into the host yourself.

### Key generation

**A build made without the key is unsigned, and nothing stops it.** `vite build` without
`NF_COMPONENTS_SIGNING_KEY` writes an unsigned descriptor without a warning, and `nf-describe`
does the same and exits 0 (it warns only when `NODE_ENV=production`). Running `nf-describe --dir` on
a signed build again without the key drops its signature. The host then renders the build in the browser only (`NF-028`), unless it pins the
build's digest. Set the key in every build and describe step, and check the result with
`nf-describe --verify --public-key`.

```sh
node -e "
const { generateKeyPairSync } = require('node:crypto')
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'shop-2026-11' }
const { d, ...pub } = jwk
console.log('NF_COMPONENTS_SIGNING_KEY=' + JSON.stringify(jwk))
console.log('public key for the host: ' + JSON.stringify(pub))
"
```

The `kid` is a label for telling keys apart when you rotate; `shop-2026-11` happens to match the
example remote's name, and it does not have to. Set `NF_COMPONENTS_SIGNING_KEY` (the private JWK) in the remote's build environment only (a CI
secret); it never leaves the build. Put the public JWK in the host's `components.ssr.publicKeys` (the
config above reads it from `NF_COMPONENTS_PUBLIC_KEY`, as a JSON string in `.env.local`).

### Rotation

`publicKeys` takes several keys. To rotate: add the new public key to the host and deploy it, then
build the remote with the new private key, and remove the old public key once no live build
(nf-serve retention) is signed with it.

**Revoking a build** (for example one with a vulnerability): rotate the key and rebuild every build
you still want, then remove the old public key from the host. Builds signed with the old key then
render in the browser only. `ssr.maxAge` bounds how long any signed build is accepted.

### Pinning

Each build's `nf-components.json` has a `digest` (`sha384-…` of the canonical descriptor). List it:
`ssr: { pinned: { '<buildId>': '<digest>' } }`.

## Stylesheets

Import CSS in an exposed module as usual (`import './Cart.css'`, CSS Modules). The build lists each
exposed module's stylesheets in the descriptor, and the host renders them as React 19 stylesheet
resources (`data-precedence="next-federation"`, the same group as island stylesheets), one link per
URL however many components use it:

- **Server-rendered component** (a verified build on a Next host): the component renders
  `<link rel="stylesheet" precedence>` with its markup, so it never paints unstyled: the link
  comes ahead of the markup, and a streamed boundary is revealed only once its stylesheet has
  loaded (React inserts the link). The server also emits a `preload` for each stylesheet and
  `<link rel="modulepreload">` for the remote entry and the module's chunks, so the browser fetches
  them while it hydrates instead of one after the other (manifest, then entry, then chunks).
- **A stylesheet that fails to load** in a streamed App Router response (a component inside
  `<Suspense>` that the shell did not include): React does not reveal that boundary's server HTML
  and renders it in the browser instead (its fallback, then the component). A stylesheet in the
  initial HTML (Pages Router, an inline boundary) only leaves the component unstyled.
- **First mounted in the browser** (a client navigation, a browser-only build, an SPA): the
  stylesheets are inserted with `preinit` before the module loads. Nothing waits for them: a slow
  or stalled stylesheet never holds the host's navigation, but the component can show unstyled
  until its CSS arrives (no FOUC guarantee there).

Only each exposed module's synchronous stylesheets are listed (what it imports statically). CSS of
chunks it loads lazily (a dynamic `import()` inside the exposed module) is injected by the remote's
own runtime when that chunk loads, with no FOUC guarantee.

The host renders only URLs listed in the descriptor and under the build's `base` (whose origin must
be one of the remote's origins). In a signed or pinned descriptor they are covered by the signature
or digest; a descriptor refused for tampering (`NF-027`) keeps none of them. A remote dev server
(`vite`) publishes no file list; its modules inject their own CSS in the browser.

## Sharing modules

What a remote can get from the host, exactly:

- **React, always the host's**: `react`, `react-dom`, `react-dom/client` and `react/jsx-runtime`.
  The remote never bundles them (`import: false`); listing them in `shared` is `NF-002`. No module
  of `react`, `react-dom` or `next` (any subpath, such as `react-dom/server` or `next/head`) ever
  falls back to a copy of the remote's: a descriptor that says `fallback: true` for one is
  refused, `nextFederationComponents` rejects `fallback: true` for one (`NF-002`), and
  `nf-describe` lists one as host-provided even when the build bundles it.
- **Host-provided modules** (the default for every other `shared` entry): the remote never bundles
  them, and the host passes each one with its real version, in
  `createRemoteComponent({ shared: { name: { version, module } } })` or once for every component
  with `registerSharedModules({ name: { version, module } })`. `version` must be a semver version
  (`NF-002` otherwise); take it from the package's `package.json`.
- **Version negotiation**: a remote entry can name the range it needs,
  `shared: { '@acme/ui': { requiredVersion: '^2.0.0' } }`. Before it loads an exposed module, the
  host checks every module that exposed module imports. A module the host does not provide, or
  provides at a version outside the range, is `NF-036`: that component renders its fallback, and
  the remote's other components still load. Nothing is fetched for the refused component, and the
  load is not retried.
- **A fallback copy**: `shared: { '@acme/ui': { requiredVersion: '^2.0.0', fallback: true } }`
  bundles the remote's own copy. The remote uses the host's copy when the host provides one that
  satisfies the range, and its own copy when the host provides none or an unsatisfying one. Use it
  for libraries that work as a second copy (utilities, a date library). Do not use it for modules
  whose identity matters: a context module or a store must be the host's, or the remote reads a
  context nobody provides.
- **`next/link`, `next/navigation` and `next/router`**: a remote can list them in `shared`. They
  are always host-provided and never fall back. The Next.js entries provide the host's own copies,
  the ones its router renders with:

  | Host                                                                  | Provides                     |
  | --------------------------------------------------------------------- | ---------------------------- |
  | App Router, `createRemoteComponent` from `@next-federation/next/components`        | `next/link`, `next/navigation` |
  | Pages Router, `createRemoteComponent` from `@next-federation/next/pages/components` | `next/link`, `next/router`   |
  | SPA, or `@next-federation/react/components`                           | none                         |

  A remote `<Link>` then navigates through the host's router (a client navigation, with the host's
  `basePath` and, in the Pages Router, its locale). A component that imports a module the host
  does not provide renders its fallback (`NF-036`); for example `next/router` in an App Router
  host, or any `next/*` in an SPA. The version the host reports is its Next.js version, recorded by
  `withNextFederation`; a canary or prerelease Next satisfies a `next/*` range by its release
  numbers (`16.5.0-canary.3` satisfies `^16.0.0`). The remote must have `next` installed as a dev dependency, so its bundler
  knows the modules' exports; it is never bundled. Other `next/*` modules (`next/image`,
  `next/head`, …) cannot be shared (`NF-002`); pass what the component needs as props.

The check reads the build descriptor: its `shared` field lists each shared module with its range,
whether it has a fallback, and the exposed modules that import it. The field is signed with the
rest of the descriptor. A remote dev server (`vite`) publishes no `shared` field, so the host does
not check a dev remote; a missing module then fails when the remote's code asks for it (`NF-029`).

## Types

A host gets the props of a remote component from the remote's own TypeScript declarations,
without importing the remote's code at build time.

**Remote (Vite).** Types are off by default in 0.x. With `types: true`, `nextFederationComponents`
emits the declarations of every exposed module into the build, with the project's own `typescript`
package and `tsconfig.json` (the TypeScript compiler API; `@module-federation/vite`'s `dts` option
stays off):

- `client/@mf-types/compiled-types/…`: the `.d.ts` of each exposed module and the local files it
  imports (stylesheet imports are dropped);
- `client/@mf-types/<Name>.d.ts` per expose (`./Cart` -> `@mf-types/Cart.d.ts`), which re-exports
  the module and its default export (Module Federation's layout).

- `client/@mf-types/index.json`: every declaration file with its sha384, and each expose's entry
  file.

The descriptor's `types` field signs that one index (its URL and sha384), so the descriptor (also
sent to the browser) stays small however many files there are, and the files are covered by the
descriptor's digest and signature through the index. Every URL is under the immutable
`/b/<buildId>/`.

**What becomes public.** The declarations of the exposed modules and of every local file they
import, which can be more than their types:

- the literal values of `const` declarations, exported or not (`export const KEY = 'sk_live_…'`
  becomes `export declare const KEY = "sk_live_…";`), of `as const` objects, of enum members, and
  of constants referenced through `typeof`, published as written;
- values TypeScript inlines from other files, including files outside the remote's folder (a
  `const url = BILLING_URL` imported from a sibling package publishes the URL);
- exported names and prop types.

**Do not expose a module whose type graph reaches a secret** (a key, an internal URL, a feature flag
name you don't want seen): types are opt-in for this reason. Comments and JSDoc are never published:
TypeScript's `removeComments` drops most of them, and the plugin strips the `/*!` comments it keeps
from each emitted file, using TypeScript's parser (string literals are left alone); a file that
still has a comment makes the build warn and publish no types. Paths are relative to the Vite root
(`rootDir`): when an emitted declaration names an absolute path, or a relative path above the root
(an import, an inferred `import("…")` type, a `declare module "…"` name, a `/// <reference path>`
or a `/// <reference types>`), the build warns, naming the file and the path, and publishes **no**
types, so the build machine's folders and the monorepo layout never become public. Package imports
(`react`, `components-context`) stay as written and resolve from the host's dependencies.

Without `typescript` installed, or when TypeScript cannot emit the declarations (a syntax or
declaration error), the build **warns and publishes no types**; it never fails because of them, and
never publishes partial types. Upgrade hosts first: an older host computes the descriptor digest
without `types` and refuses a build that has them (`NF-027`, rendered in the browser only).

**Remote (Rspack or webpack).** `nf-describe --types` writes and signs `client/@mf-types/index.json`
(without `--types` the folder is never signed). Module Federation's own `dts` plugin writes a zip
(`@mf-types.zip`) and fails on any type error, and `nf-describe` does not read the zip: unzip it into
`client/@mf-types/` before `nf-describe --types`, or emit the folder with
`tsc --declaration --emitDeclarationOnly` in the same layout.

**Host.** `nf-types` (in `@next-federation/next`) downloads the declarations of each remote's
current build into the project and writes `next-federation-types/index.d.ts`:

```sh
node --env-file=.env.local node_modules/@next-federation/next/dist/types/cli.js \
  --config lib/federation.config.ts
```

That is `nf-types --config lib/federation.config.ts` with the environment loaded. Options:
`--remote shop` (repeatable) limits it to some remotes, `--out next-federation-types` sets the
folder. Add it to your scripts, for example `"types": "node --env-file=.env.local
node_modules/@next-federation/next/dist/types/cli.js --config lib/federation.config.ts"`.

`--config` names a module that exports your `defineFederation(...)` result as `federation` (or as
its default export): `lib/federation.config.ts` from [Host: configure the
remote](#host-configure-the-remote). Three things to know:

- **The config is loaded with plain Node, not Next.js.** It must not import `next/*`,
  `server-only` or `@/` aliases. The guides' layout keeps those in `lib/federation.ts` for this
  reason; pointing `--config` at a file that imports `next/headers` fails.
- **`nf-types` does not read `.env.local`.** A config that reads `process.env` sees nothing, and
  `JSON.parse(process.env.NF_COMPONENTS_PUBLIC_KEY!)` fails with `SyntaxError: "undefined" is not
  valid JSON`. Load the file with Node's `--env-file=.env.local` as above (or `set -a; . ./.env.local;
  set +a` in a shell, then `nf-types ...`). The `cli.js` path above is what the `nf-types` bin runs,
  so it works with any package manager.
- **`.ts` configs need a Node that strips types**, and print
  `[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of .../federation.config.ts is not specified`
  when `package.json` has no `"type"`. The warning is harmless (Node re-parses the file as an ES
  module). A `.mjs` config avoids both, on every Node.

For each remote, `nf-types`:

1. fetches the descriptor from the remote's configured descriptor URL (no credentials, no
   redirects), and refuses a build served outside the remote's origins (`NF-005`);
2. verifies it with the remote's `components.ssr` trust policy, a signature from one of
   `publicKeys` or a `pinned` digest (`unsafe-dev` in development, with a warning), **before** it
   fetches anything the descriptor names (`NF-028` unverified, `NF-027` altered; a remote with
   `ssr: false` has no policy, so its types are refused);
3. downloads the declarations index and checks its raw bytes against the signed sha384 (`NF-027`)
   before it reads the list (`NF-029` for an invalid index: more than 2000 files, or a path that
   is not a plain relative `.d.ts` path);
4. downloads every listed file from under the build's base (at most 1 MiB per file, 20 MiB per
   build, counted while the body streams), checks each file's raw bytes against its sha384
   (`NF-027`), writes those bytes unchanged, and only then replaces
   `next-federation-types/<remote>/`. A failed remote keeps the types it had, and the command
   exits 1. A verified build that publishes no types removes the remote's previous folder and
   its `index.d.ts` entry (so its `RemoteProps` become a type error rather than stale types).

Nothing downloaded ever runs: the files are only read by TypeScript. Next.js's default
`tsconfig.json` (`include: ["**/*.ts", …]`, `skipLibCheck: true`) picks up `index.d.ts`; with a
narrower `include`, add `next-federation-types`. Then:

```tsx
'use client'
import { createRemoteComponent } from '@next-federation/next/components'
import type { RemoteProps } from '@next-federation/next/components'

export const Cart = createRemoteComponent<RemoteProps<'shop', './Cart'>>({
  expose: './Cart',
})

// <Cart descriptor={descriptor} items="3" /> is now a type error.
```

`RemoteProps<remote, expose>` reads the props of the expose's default export from the global
`NextFederationRemoteComponents` interface that `index.d.ts` fills (remote key -> expose -> module
type). A remote or expose that `nf-types` did not download is a type error. The types are those of
the build that was current when `nf-types` ran: **run `nf-types` before `tsc` and before `next build`**
(in CI, and after you change a remote; on Next 16, run `next typegen` before `tsc` too, or a fresh
checkout fails with `Cannot find name 'LayoutProps'`), and commit the folder or not as you prefer (it is
regenerated on every run). Modules the declarations import (`react`, shared packages) resolve from
the host's own dependencies.

If you skip it, `RemoteProps` has nothing to read, and TypeScript (so `next build`, which type
checks) fails on the line that uses it with an error that does not mention `nf-types`:

```
error TS2344: Type '"widgets"' does not satisfy the constraint 'never'.
```

and every use of the component then fails too, because its type is `RemoteComponentType<never>`:

```
error TS2786: 'Widget' cannot be used as a JSX component.
  Its type 'RemoteComponentType<never>' is not a valid JSX element type.
```

`never` means the interface is empty: there is no `next-federation-types/index.d.ts` yet. Run
`nf-types` and the error goes. When the folder exists but the expose is wrong, the constraint lists
the exposes it knows (`Type '"./Cart"' does not satisfy the constraint '"./Greeting" | "./NavLink"'`).
`nf-types` needs the remote running and reachable (`NF-029` otherwise, and it keeps the types it
had). `RemoteProps` is optional: `createRemoteComponent<{ items: number }>` works without
`nf-types`, with the props typed by hand.

## Client-only Next.js apps

Many Next.js apps render almost everything on the client: pages are client components, data is
fetched in the browser, and state lives in React context or a client store. In such an app, remote
components are the default choice. Islands fit server-rendered content.

Each remote component is part of the host's React tree. It runs on the host's React, it reads
the host's context, and it navigates with the host's router.

**Share app state through a small shared package.** Put the context (or the store hook) the host
and its remotes both use in its own package, for example `@acme/app-state`. Keep it small: types,
a context object, and hooks. The host owns the provider and the state. The remote lists the
package in `shared` without a fallback, so it always reads the host's instance:

```ts
// packages/app-state/src/index.ts (a workspace or published package both sides depend on)
'use client'
import { createContext, useContext } from 'react'

export type AppState = { user: { name: string } | null; cartCount: number }
export const AppStateContext = createContext<AppState | null>(null)
export function useAppState(): AppState {
  const state = useContext(AppStateContext)
  if (!state) throw new Error('useAppState needs the host AppStateContext provider')
  return state
}
```

```ts
// remote vite.config.ts
nextFederationComponents({
  name: 'shop',
  base: 'https://shop.example.com/',
  exposes: { './CartBadge': './src/CartBadge.tsx' },
  shared: {
    '@acme/app-state': { requiredVersion: '^1.0.0' }, // always the host's instance
    'next/link': {},
  },
})
```

```tsx
// host: lib/remote.tsx
'use client'
import * as AppState from '@acme/app-state'
import { createRemoteComponent } from '@next-federation/next/components'

export const CartBadge = createRemoteComponent({
  expose: './CartBadge',
  // The installed version (from its package.json): remotes' ranges are checked against it.
  shared: { '@acme/app-state': { version: '1.2.0', module: AppState } },
  fallback: null,
})
```

The host renders `<AppStateContext.Provider value={state}>` around its layout, and every remote
component under it reads the same state. Change the shared package in a backwards-compatible way.
When it breaks compatibility, raise its major version, so a remote built against the new version
renders its fallback (`NF-036`) on hosts that have not upgraded, instead of failing at runtime.

**Navigation**: remote components import `next/link` and `useRouter`/`usePathname` from the
host's router module, listed in their `shared` (see above). The remote and the host then share
one router. A component that must also render in an SPA or in both routers takes a link component
or an `onNavigate` callback as a prop instead.

## Runtime behaviour

- **One React**: the host registers its own `react`, `react/jsx-runtime`, `react-dom` and
  `react-dom/client` (whichever copy renders it, per Next layer) plus your `shared` modules and,
  with a Next.js entry, its `next/*` modules.
- **Loading**: `ErrorBoundary(errorFallback) > Suspense(fallback) > component`. A loaded module is
  cached per build. A failure is cached too (no retry loop): the server retries it after one
  second; the browser retries with a bounded backoff (500 ms, 1 s, 2 s) and then shows
  `errorFallback` for that page.
- **Render errors** (`NF-040`): React error boundaries do not run on the server, so the host catches
  an error the exposed component throws in its own render there. The server HTML gets `fallback`
  (marked for the browser), the error is logged once per build, expose and message, and the browser
  renders the component after hydration. This keeps a statically prerendered page buildable: `next
  build` fails a prerender on any render error that reaches React, even inside `<Suspense>`. A
  component that only fails on the server (it reads `window` during render) then works in the
  browser; one that throws there too renders `errorFallback`, logs `NF-040` and sends
  `component:error`. The server catches errors of the exposed function component's own render, not
  of the components it renders, nor of a class, `memo` or `forwardRef` export: such an error still
  reaches Next (the browser renders that boundary at request time; a build-time prerender fails).
  Keep browser-only code in effects, or render that part only after mount.
- **An inert boundary can be replaced early**: while the browser retries, React 19 keeps the server
  HTML of the boundary only as long as nothing above it re-renders with changed props or context;
  if a parent does, React replaces the dehydrated boundary with the fallback (and logs two
  recoverable errors in the console). The component then loads into the fallback's place.
- **Remote down**: the page answers 200. A host that never fetched a descriptor renders
  `errorFallback`; one that did keeps rendering the last known build. If the server rendered the
  component but the browser cannot load its module, the server HTML stays visible (not
  interactive) while the browser retries, and `errorFallback` replaces it only when every attempt
  failed.
- **Redeploys** are picked up without a host restart (within `revalidate`), and in-flight pages keep
  loading the build they were rendered with.
- **Events**: in the browser, every load and failure is a `nf:component` `CustomEvent` on
  `document` (`COMPONENT_EVENT`), a render error included (`component:error` with `code: 'NF-040'`,
  `remote`, `expose`, `buildId` and `error`); on the server, `defineFederation({ onEvent })`
  receives `component:descriptor` and the descriptor's `component:error`. Load and render failures
  on the server are logged (`NF-029`, `NF-040`, ...), not sent to `onEvent`: they happen in the
  client component's server render, which has no access to the federation.

## Devtools

The [Module Federation Chrome devtools](https://module-federation.io/guide/debug/chrome-devtool)
work with remote components. They read the page's `window.__FEDERATION__`: the global snapshot
(`moduleInfo`), the runtime instances (`__INSTANCES__`), and the plugins the extension pushes into
`__GLOBAL_PLUGIN__` before the page runs. Remote components load through the real
`@module-federation/runtime`, registering each build with its `mf-manifest.json` as the entry, so:

- the host appears as the consumer `nf_host`, and each remote as a producer keyed
  `<container name>:<manifest URL>` (`/b/<buildId>/mf-manifest.json`, so a new build is a new
  entry), with its exposed modules and shared modules from the manifest;
- the extension's plugins run inside the remote components runtime (its `loadRemoteSnapshot` hook
  posts the snapshot to the panel); the instance is created on the first load, so it always picks
  them up;
- the panel fetches each producer's manifest for its details: `nf-serve` answers it with
  `Access-Control-Allow-Origin: *`.

Only the browser has these globals: server rendering does not show in the panel. The panel's proxy
feature (pointing a remote at another build) changes browser loads only; the server keeps
rendering the verified build, so a proxied component's server HTML and the browser's module can
differ until it hydrates.

## Requirements and limits

- **Node.js ≥ 20.16 for server rendering.** The packages run on Node 20.9, but the server loader
  needs `process.getBuiltinModule`; on an older Node every remote component renders in the browser
  only (`NF-028`, logged once).
- **Memory**: each server layer keeps at most `maxBuilds` (default 5) distinct builds of a remote
  loaded, evicting the oldest. An old build is garbage-collected once nothing references it: its
  code is evaluated with `new Function`, never written to disk or `import()`ed, and registering
  another build of the container makes the Module Federation runtime drop the previous build's
  container and entry load. When the runtime replaces its MF instance (after a timed-out load, or a
  module registered late) it removes the old one from the MF registry, and when a layer moves to a
  new scope ([Mixed-router hosts](#mixed-router-hosts)) it also drops the old scope's tagged
  registry entries, so neither stays alive. `@module-federation/vite` keeps one `__mf_init__…`
  entry per distinct build (a settled promise and its resolvers), never removed (see the
  [maintainer note](../maintainers/mf-vite-init-keys.md)); the host keeps it in the layer's scope,
  not on `globalThis`.
- **Mixed-router hosts**: each router layer loads its own copy of a remote build, and only builds
  the server loader knows server-render in both layers ([Mixed-router hosts](#mixed-router-hosts)).
  Tested: an App Router host with a Pages route server-renders the Vite remote and the Rspack
  remote in both layers, in either order, the one-React probe holds in each, and both hydrate
  without warnings.
- **First request after a deploy (App Router)**: the server streams the component (the shell has the
  fallback, the markup follows in the same response); later requests render it inline.
- **Server logs**: when a build renders browser-only at request time (an integrity failure, for
  example), Next logs the error React reports for that Suspense boundary, besides the `NF-` line.
- **`next dev --webpack`**: the dev server re-creates the host's server modules when it compiles
  another route; the re-created runtime loads the remote's server code again and keeps
  server-rendering ([Mixed-router hosts](#mixed-router-hosts)). A runtime whose own share cache holds
  another instance of a host module renders browser-only (`NF-028`, "stale").
- **Load timeout**: one load attempt (manifest, entry and chunks) fails after 10 s, so a stalled
  remote never holds a server render; the server then renders the component in the browser only.
- **Edge runtime**: no server rendering (no Node built-ins); components render in the browser.
- **Remote dev server**: `vite` (serve) answers `/_nf/components.json` with `ssr: null`, so hosts
  render a dev remote in the browser only. Use a build (`vite build` + `nf-serve`) to test server
  rendering. Edits do not hot-reload inside the host: reload the host page to see them.

## Content Security Policy

Add the remote's origin to `script-src` (the remote entry and its chunks are ES modules loaded from
it), `style-src` (its stylesheets) and `connect-src` (the browser fetches `mf-manifest.json`, and an
SPA fetches the descriptor).
See [CSP](csp.md).

Related: [Writing an island remote](writing-an-island-remote.md), [Deployment](deployment.md),
[Limits](limits.md), [Migrating from nextjs-mf](migrating-from-nextjs-mf.md).
