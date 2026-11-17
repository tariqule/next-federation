# @next-federation/vite

Builds a `next-federation` island remote with Vite 8. It wraps
[`@vitejs/plugin-rsc`](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-rsc),
pinned to exactly **0.5.39**.

Requires Node `^20.19.0 || >=22.12.0` (Vite 8's floor), unlike the host-side packages (`>=20.9`).

## Usage

```ts
// vite.config.ts
import { nextFederationIslands } from '@next-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: nextFederationIslands({
    name: 'shop',
    base: 'https://shop.example.com/',
    hosts: ['https://www.example.com'],
    issuers: {
      'https://www.example.com': 'https://www.example.com/api/next-federation/jwks',
    },
    islands: {
      ProductPanel: './src/islands/ProductPanel.tsx',
      MyOrders: { entry: './src/islands/MyOrders.tsx', private: true },
    },
  }),
})
```

`vite` serves the remote in development. `vite build` writes `dist/<buildId>/{client,ssr,rsc}`
and `dist/<buildId>/nf-build.json` (`{ name, buildId, builtAt, base }`); serve it with
`nf-serve --dir dist --port <port>` from `@next-federation/server`. `rsc/index.js` default-exports
the island handler, `(req: Request) => Promise<Response>`, and the client entry exports
`mountIsland`.

An island entry is a Server Component module with a default export. It may not start with
`'use client'` (`NF-002`); put client code in components it renders.

## Options

```ts
type IslandRemoteOptions = {
  name: string // remote id, /^[A-Za-z][A-Za-z0-9_-]*$/
  base: string // absolute URL the remote is served from, e.g. 'https://shop.example.com/'
  islands: Record<string, string | { entry: string; private?: boolean }>
  hosts: string[] // exact host origins allowed to embed (CORS + Origin check); no '*'
  issuers?: Record<string, string> // issuer → JWKS URL
  buildId?: string // default: NF_BUILD_ID, then 'dev' (serve) or a timestamp (build)
  versioned?: boolean // default: true for build, false for serve
  maxAge?: number // public island max-age in seconds, default 60
  outDir?: string // output folder, default 'dist'
  share?: boolean | { libs?: string[] } // React sharing; default: true for build, false for serve
  allowInsecureHttp?: boolean // accept a plain-http base / JWKS URL in production (warns once)
  actions?: {
    requireIdentity?: boolean // every Server Action needs a verified token (401 NF-014); default false
    maxBodyBytes?: number // Server Action body limit, default 1048576
  }
}
```

A remote whose Server Actions read or change private data should set
`actions: { requireIdentity: true }`, so an action that someone forgot to wrap in
`requireIdentity()` is still refused without a token.

`resolveOptions(options, { command, env, now })` validates them (`NF-020` for a relative `base`,
`NF-002` for everything else) and returns the resolved shape. A `buildId` matches
`/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` (the pattern `nf-serve` and the components descriptor use).
`base` and the JWKS URLs must use `https` unless the host is `localhost`, `127.0.0.0/8` or `[::1]`,
the command is `serve`, or `NODE_ENV` is `development` or `test`; `allowInsecureHttp: true`
accepts plain `http` anyway (`nextFederationComponents` takes the same option for its `base`). With `versioned`, assets are
build-pinned: the public base becomes `<base>b/<buildId>/` and the output goes to
`<outDir>/<buildId>/{client,ssr,rsc}`.

## React sharing

Production builds share React with the other island remotes on the page. Each exact React version
is downloaded and evaluated once: two remotes on `19.3.1` run on one copy, a remote on `19.3.0`
uses its own. `react`, `react-dom`, `react-dom/client` and `react/jsx-runtime` are always shared;
`share: { libs: ['@acme/design'] }` adds more bare specifiers, each at its installed exact version
and bound to the build's React: a remote on another React never takes them. Production builds
only (a `NODE_ENV` other than `production` bundles React's development copies, which never share).
`react-server-dom-webpack` is never shareable (`NF-002`): the flight client stays per build.
`share: false` builds the remote exactly as without sharing. Dev servers never share.

- The client entry awaits the page's island share scope, then imports the bootstrap, so every
  module that imports React runs on the copy the scope chose.
- Every bare import of a shared lib, island code and React's own CommonJS requires included,
  returns that copy.
- The build's own copies sit in one lazy `assets/react-<hash>.js` chunk, downloaded only when this
  build provides its React version.
- The scope lives in `__FEDERATION__.__SHARE__['@next-federation/island-share@1']['nf-islands']`,
  in Module Federation's entry shape, under a key no Module Federation app uses.
- A host on the same stable React can provide its own with `provideHostReact()` from
  `@next-federation/react/share`. The envelope's `reactVersion` is the version a remote shares under.

## How a remote is built

- **Run the server build with `NODE_ENV=production`.** `nf-serve` does this. A production build
  always redacts Server Action errors (its mode comes from the build, not from `NODE_ENV`), but React
  picks its development or production Flight server from `NODE_ENV` at runtime; a production build
  started with another value logs an `NF-002` warning once. Set `NODE_ENV=production` when you run
  `rsc/index.js` outside `nf-serve`.

- **Absolute base.** plugin-rsc rejects a relative `base`, and hosts on other origins need absolute
  asset URLs.
- **One flight client per build.** plugin-rsc keeps client-reference loading in page globals. The
  browser flight client of every build is rewritten (in the build and in Vite's dependency
  optimizer) to read `globalThis.__nf_rsc__[<this build's public base>]`, the slot the island
  bootstrap registers. Two remotes, or two builds of one remote, on one page never resolve each
  other's client references. The optimizer cache folder is named after a hash of that key, since
  Vite's pre-bundle cache does not notice the change.
- **CSS goes in the envelope.** `rscCssTransform` is off (islands emit no hoistable `<link>`s).
  Every island module gets one generated `import.meta.viteRsc.loadCss()` export. Do not call
  `loadCss()` in an island module yourself: plugin-rsc 0.5.39 wires only the first call in a module,
  so the build fails with `NF-002` if you do.
- **The bootstrap keeps its exports** (`preserveEntrySignatures: 'exports-only'`), so hosts can
  import `mountIsland`.
- **One `@next-federation/server` per remote.** The `rsc` and `ssr` builds bundle every
  `@next-federation/*` package, so `getIdentity()` in an island reads the same identity store the
  island handler fills.
- **Dev CORS.** Vite's own CORS middleware is off; module assets get CORS for `hosts` only, and
  `/_nf/` requests are answered by the island handler, CORS included, as in production.
- **No Fast Refresh.** `@vitejs/plugin-react` and `@vitejs/plugin-react-swc` are rejected with `NF-002`; Vite's built-in oxc compiles
  JSX. Fast Refresh code needs a preamble that only Vite-served pages have, so it cannot run inside
  a host. Known DX gap: islands rendered inside a host reload instead of hot-refreshing.
- **Server Actions reach client components as props.** A `'use server'` file imported by a client
  module (browser or SSR build) fails with `NF-034`; pass the action from a Server Component
  instead. A plain `<form action={action}>` or `formAction={action}` warns `NF-035`: use `<Form>`
  from `@next-federation/island`. In dev, the action route loads only files the server build has
  seen with `'use server'`.

## plugin-rsc version

Any version other than 0.5.39 fails with `NF-025`. A CI canary job may set `NF_ALLOW_PLUGIN_RSC=1`
to turn that into a warning while testing a newer plugin-rsc.

## Components remote (remote components)

```ts
import { nextFederationComponents } from '@next-federation/vite'

export default defineConfig({
  plugins: [
    nextFederationComponents({
      name: 'shop', // Module Federation container name (a JS identifier)
      base: 'https://shop.example.com/',
      exposes: { './Cart': './src/Cart.tsx' },
      shared: {
        '@acme/host-context': {}, // host-provided, besides React
        '@acme/date-utils': { requiredVersion: '^2.0.0', fallback: true }, // own copy if needed
        'next/link': {}, // the host's next/link (Next.js hosts only)
      },
    }),
  ],
})
```

Wraps `@module-federation/vite` (pinned to exactly 1.24.0: `NF-026` otherwise, `NF_ALLOW_MF_VITE=1`
for a canary job). `vite build` builds the browser copy and a CommonJS server copy into
`<outDir>/<buildId>/client/` (served under `<base>b/<buildId>/`), plus `nf-components.json` (the
build descriptor with the sha384 of every server file and each exposed module's stylesheets and
JS chunks, which hosts link and modulepreload; signed with ES256 when
`NF_COMPONENTS_SIGNING_KEY` holds a private JWK) and `nf-build.json`; `nf-serve --dir <outDir>`
serves it. React, `react-dom`, `react-dom/client` and `react/jsx-runtime` are always host-provided.
Every other `shared` entry is host-provided too (never bundled) unless it sets `fallback: true`: then
the build bundles its own copy and uses it when the host's copy is missing or outside
`requiredVersion` (a semver range). Without a fallback, a missing or unsatisfying host copy renders
the host's fallback (`NF-036`). `next/link`, `next/navigation` and `next/router` can be shared
(host-provided only; the remote needs `next` as a dev dependency). No `react`, `react-dom` or
`next` module (any subpath, such as `react-dom/server`) can set `fallback: true` (`NF-002`). The
descriptor lists each shared module with its range, its fallback flag and the exposed modules that
import it (signed).
An exposed module compiled with Fast Refresh fails the build (`NF-002`). The dev server answers
`/_nf/components.json` with `ssr: null` (hosts render a dev remote in the browser only).
Programmatic builds set `NF_VITE_COMMAND=build` (the plugin reads the command before Vite does).
`types: true` (off by default in 0.x) emits the exposed modules' declarations into
`client/@mf-types/` (no comments, `/*!` ones included; paths relative to the Vite root) with an `index.json` of their
sha384, and signs that index in the descriptor, for hosts' `nf-types`. The declarations of the
exposed modules and the local files they import become public, **including the literal values of
constants, `as const` objects and enums** (also ones inlined from outside the root): don't expose
a module whose type graph reaches a secret. Without `typescript`, when TypeScript cannot emit
them, or when a declaration names an absolute path or a path above the root, the build warns and
publishes no types.
Guide: [Remote components](../../docs/guides/remote-components.md).

## API

| Export                                   | Purpose                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| `nextFederationIslands(options)`         | The Vite plugin array for an island remote.          |
| `resolveOptions(options, ctx)`           | Validate and resolve options (`NF-020`, `NF-002`).   |
| `IslandRemoteOptions`, `ResolvedOptions` | Option types.                                        |
| `BuildInfo`                              | The shape written to `nf-build.json`.                |
| `nextFederationComponents(options)`      | The Vite plugins for a components remote.            |
| `ComponentsRemoteOptions`                | Its option type.                                     |
| `SharedModuleOptions`                    | One `shared` entry: `{ requiredVersion, fallback }`. |
| `ComponentsBuildInfo`                    | Its `nf-build.json` shape (`kind: 'components'`).    |

Guide: [Writing an island remote](../../docs/guides/writing-an-island-remote.md). For what islands cost
and cannot do, see [Limits](../../docs/guides/limits.md).
