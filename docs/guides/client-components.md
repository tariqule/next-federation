# Client components (Mode A)

Mode A loads a remote's **client component** at runtime through the Module Federation 2.0 runtime
and renders it inside the host's own React tree. The component runs on the host's React, reads the
host's React context, and can take any props, including functions and children. Next.js hosts
(App Router and Pages Router) **server-render** it and the browser hydrates it. SPA hosts render
it in the browser.

## Islands or client components?

| | Islands | Client components (Mode A) |
| --- | --- | --- |
| What the remote ships | Server-rendered HTML + its own React tree | A client component module |
| React | The remote's own (shared between islands when versions match) | Always the host's |
| Host React context | Does not cross into the island | Readable (shared context modules) |
| Props | Plain JSON | Anything a client component takes |
| Server rendering | Always, on the remote | On the host, for verified builds only |
| Remote server code in the host process | Never | Yes, for verified builds (see Integrity) |
| Remote framework | Anything that serves the island protocol | Any Module Federation 2.0 build: `nextFederationComponents` (Vite), or Rspack/webpack + `nf-describe` |

Use islands when the remote must stay isolated, or owns its data fetching. Use client components
for interactive pieces that must feel like part of the host: they share its React, context and
event handlers.

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
      // Modules the host provides, besides React (never bundled):
      shared: ['@acme/host-context'],
    }),
  ],
})
```

`vite build` writes `dist/<buildId>/`:

- `client/`: the browser build (`remoteEntry.js`, `mf-manifest.json`, chunks) **and** the server
  copy (`remoteEntry.ssr.js` and its `.cjs` chunks), served under the immutable
  `https://shop.example.com/b/<buildId>/`.
- `nf-components.json`: the build descriptor: `buildId`, the manifest URL, the **sha384 of every
  server file** and the **browser files** of each exposed module (its stylesheets and JS chunks, as
  absolute `/b/<buildId>/…` URLs), plus its digest and, when signed, an ES256 JWS over all of it.
- `nf-build.json`: what `nf-serve` reads.

`react`, `react-dom`, `react-dom/client` and `react/jsx-runtime` are always host-provided
(`import: false`). The build id is `buildId`, `NF_BUILD_ID`, or the build time.

Serve it with `nf-serve --dir dist --port 4110`: `/_nf/components.json` is the current build's
descriptor (`Cache-Control: no-store`), `/b/<buildId>/…` serves every build kept by retention, and
a retired build answers `410` (`NF-023`), exactly as for islands.

Exposed modules must not be compiled with Fast Refresh (a host page has no Vite preamble). Without
`@vitejs/plugin-react` nothing is needed (Vite compiles JSX). If the remote has its own dev app
with the plugin, exclude the exposed files: `react({ exclude: [/src\/Cart\.tsx$/] })`. The build
fails with `NF-002` when an exposed module contains Fast Refresh code.

`@module-federation/vite` is pinned to exactly **1.24.0** (`NF-026` otherwise; `NF_ALLOW_MF_VITE=1`
for a canary job only).

## Remotes built with Rspack or webpack

Any Module Federation 2.0 remote that emits `mf-manifest.json` works, built with
`@module-federation/enhanced`. The e2e suite runs one built with Rspack 2.3.0 and
`@module-federation/enhanced` 2.9.2 against App Router, Pages Router and SPA hosts
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

Then describe the build (`NF_COMPONENTS_SIGNING_KEY` set signs it) and serve it:

```sh
NF_BUILD_ID=2026-11-16a rspack build
nf-describe --dir dist/2026-11-16a --ssr-entry server/remoteEntry.js
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

It never reads or writes a build file through a symlink, and refuses server files that resolve
outside the build folder (`NF-002`).

**Run `nf-describe` before you upload the build** (for example to a CDN): it rewrites
`client/mf-manifest.json`, whose sha384 is in the descriptor. A copy of the manifest uploaded
earlier fails the digest check, and hosts then render the build in the browser only (`NF-027`).

The build id is the folder name (`--build-id` otherwise); the public URL is the manifest's absolute
`publicPath` (`--base` when it is `auto`) and must contain the build id. `--no-ssr` describes a
browser-only build. Describing a build again keeps its build time.

`nf-describe --dir <build folder> --verify` checks a described build before you ship it
(`NF-027` otherwise): the digest covers the payload (assets included), the JWS signs exactly that
payload, the assets are the ones `mf-manifest.json` lists, and every server file still matches its
sha384. With `--public-key <public JWK or file>` (repeatable) it also verifies the ES256
signature, as hosts do; **without one the signature is not checked**, and the output says so.

## Host: configure the remote

```ts
// lib/federation.ts (server)
import { defineFederation } from '@next-federation/core'

export const federation = defineFederation({
  remotes: {
    shop: {
      origin: 'https://shop.example.com',
      components: {
        ssr: { publicKeys: [SHOP_PUBLIC_JWK] }, // see Integrity
        // descriptor: 'https://shop.example.com/_nf/components.json' (default)
        // revalidate: 60      seconds the descriptor is cached (default islands.revalidate)
        // maxBuilds: 5        distinct builds a process keeps loaded
      },
    },
  },
})
```

Bind the exposed component in a `'use client'` module:

```tsx
'use client'
import * as HostContext from '@acme/host-context'
import { createRemoteComponent } from '@next-federation/react/components'

export const Cart = createRemoteComponent<{ items: number }>({
  expose: './Cart',
  // Modules this host provides to the remote (its `shared` list):
  shared: { '@acme/host-context': { version: '1.0.0', module: HostContext } },
  fallback: <p>Cart unavailable</p>,
})
```

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
  can be prerendered static with the remote's markup in it. Put the component inside `<Suspense>`:
  if the remote is down at build time, the failure is short-lived and becomes a dynamic hole
  instead of failing the build.
- **Per request**: `getComponentDescriptor(federation, 'shop', { dynamic: true })` inside
  `<Suspense>`: a partial prerender (the shell is static, the component streams in). Outside
  `<Suspense>` Next fails the build, as for any uncached data.

Without `cacheComponents` the descriptor is fetched with `next: { revalidate }`; `dynamic: true`
uses `cache: 'no-store'`. The library keeps no in-process cache of its own (it would hide the fetch
from Next) and reads no wall clock.

### Pages Router

```tsx
import { getComponentDescriptor } from '@next-federation/next/pages/server'

export const getServerSideProps = async () => ({
  props: { descriptor: await getComponentDescriptor(federation, 'shop') },
})

export default function Page({ descriptor }) {
  return <Cart descriptor={descriptor} items={3} />
}
```

`getStaticProps` works the same way. In `getServerSideProps` the descriptor is fetched on every
request: Next's `next: { revalidate }` fetch cache exists only in the App Router. The Pages Router waits for Suspense during server rendering, so
the component's HTML is always inline. `preloadRemoteComponent(descriptor, './Cart')` (or
`Cart.preload(descriptor)`) loads the module ahead of rendering in `getServerSideProps`.

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

Set `NF_COMPONENTS_SIGNING_KEY` (the private JWK) in the remote's build environment only (a CI
secret); it never leaves the build. Put the public JWK in the host's `components.ssr.publicKeys`.

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
  The remote never bundles them (`import: false`); listing them in `shared` is `NF-002`.
- **Modules the host provides**: every other entry of the remote's `shared` list must be passed by
  the host in `createRemoteComponent({ shared: { name: { version, module } } })`. The remote never
  bundles them either, so **the host must provide every module the remote shares**; a missing one
  fails the load (`NF-029`) and the fallback renders.
- **No version negotiation**: the host registers each module as a singleton with
  `requiredVersion: false`, and the remote has no copy of its own to fall back to, so the remote
  always gets the host's copy, whatever its version. A remote's
  `shared: { name: { requiredVersion: '^2.0.0' } }` is passed to Module Federation as a singleton
  range: a mismatch only produces a Module Federation runtime warning, and the host's copy is still
  used. Keep shared modules small and backwards-compatible (a context module, a design-system
  package both sides pin).
- **No `next/*`**: the library never registers Next.js modules (`next/link`, `next/navigation`,
  `next/image`). A remote is a Vite build without Next; pass what it needs (callbacks, an `href`
  builder, a link component) as props instead.

## Runtime behaviour

- **One React**: the host registers its own `react`, `react/jsx-runtime`, `react-dom` and
  `react-dom/client` (whichever copy renders it, per Next layer) plus your `shared` modules.
- **Loading**: `ErrorBoundary > Suspense(fallback) > component`. A loaded module is cached per build.
  A failure is cached too (no retry loop): the server retries it after one second; the browser
  retries with a bounded backoff (500 ms, 1 s, 2 s) and then shows the fallback for that page.
- **An inert boundary can be replaced early**: while the browser retries, React 19 keeps the server
  HTML of the boundary only as long as nothing above it re-renders with changed props or context;
  if a parent does, React replaces the dehydrated boundary with the fallback (and logs two
  recoverable errors in the console). The component then loads into the fallback's place.
- **Remote down**: the page answers 200. A host that never fetched a descriptor renders the
  fallback; one that did keeps rendering the last known build. If the server rendered the
  component but the browser cannot load its module, the server HTML stays visible (not
  interactive) while the browser retries, and the fallback replaces it only when every attempt
  failed.
- **Redeploys** are picked up without a host restart (within `revalidate`), and in-flight pages keep
  loading the build they were rendered with.
- **Events**: in the browser, every load and failure is a `nf:component` `CustomEvent` on
  `document` (`COMPONENT_EVENT`); on the server, `defineFederation({ onEvent })` receives
  `component:descriptor` and `component:error`.

## Requirements and limits

- **Node.js ≥ 20.16 for server rendering.** The packages run on Node 20.9, but the server loader
  needs `process.getBuiltinModule`; on an older Node every remote component renders in the browser
  only (`NF-028`, logged once).
- **Memory**: a process keeps at most `maxBuilds` (default 5) distinct builds of a remote loaded,
  evicting the oldest. Old builds are garbage-collected (their code is evaluated with
  `new Function`, never written to disk or `import()`ed). One residue remains per distinct build:
  `@module-federation/vite` sets one `globalThis.__mf_init__…` key per distinct build (a settled
  promise and its resolvers), never removed (upstream draft: `docs/upstream/mf-vite-init-keys.md`).
- **Mixed-router hosts** (App Router and Pages Router routes in one host) are supported after v1.
  `@module-federation/vite`'s process-wide share cache keeps the first React that registers; the
  other router's routes render remote components in the browser only (`NF-028`), and never crash.
  Tested: an App Router host with a Pages route renders it browser-only and the component works.
- **First request after a deploy (App Router)**: the server streams the component (the shell has the
  fallback, the markup follows in the same response); later requests render it inline.
- **Server logs**: when a build renders browser-only at request time (integrity failure, two
  Reacts), Next logs the error React reports for that Suspense boundary, besides the `NF-` line.
- **`next dev --webpack`**: when the dev server compiles another route it re-creates the host's
  server modules, while `@module-federation/vite`'s process-wide share cache keeps the old ones. The
  host detects it and renders remote components in the browser only until the dev server restarts
  (`NF-028`, "stale"); production builds and `next dev` with Turbopack are not affected.
- **Load timeout**: one load attempt (manifest, entry and chunks) fails after 10 s, so a stalled
  remote never holds a server render; the server then renders the component in the browser only.
- **Edge runtime**: no server rendering (no Node built-ins); components render in the browser.
- **Remote dev server**: `vite` (serve) answers `/_nf/components.json` with `ssr: null`, so hosts
  render a dev remote in the browser only. Use a build (`vite build` + `nf-serve`) to test server
  rendering.

## Content Security Policy

Add the remote's origin to `script-src` (the remote entry and its chunks are ES modules loaded from
it), `style-src` (its stylesheets) and `connect-src` (the browser fetches `mf-manifest.json`, and an
SPA fetches the descriptor).
See [CSP](csp.md).

Related: [Writing an island remote](writing-an-island-remote.md), [Deployment](deployment.md),
[Limits](limits.md), [Migrating from nextjs-mf](migrating-from-nextjs-mf.md).
