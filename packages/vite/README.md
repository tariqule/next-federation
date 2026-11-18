# @next-federation/vite

Vite plugins that build a `next-federation` island remote (`nextFederationIslands`) or
remote components (`nextFederationComponents`) with Vite 8. The island plugin wraps
[`@vitejs/plugin-rsc`](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-rsc),
pinned to exactly **0.5.39**.

Requires Node `^20.19.0 || >=22.12.0` (Vite 8's floor), unlike the host-side packages (`>=20.9`).

## Install

```sh
# An island remote: react-server-dom-webpack at exactly your React's version
npm install --save-exact react@19.3.1 react-dom@19.3.1 react-server-dom-webpack@19.3.1
npm install -D @next-federation/vite @next-federation/server vite
```

Check `package.json` afterwards: a caret that was already there (`create-vite` writes
`"react": "^19.3.1"`) may stay, and the range must be exact.

`react-server-dom-webpack` is an optional peer dependency: a components remote
(`nextFederationComponents`) never uses it, so npm accepts any React 19 there. An island remote
needs it (its bootstrap imports the browser flight client): `nextFederationIslands` fails with
`NF-002` and the install command for your React version when it is missing.

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
    timeoutMs?: number // browser: reject with NF-038 when no response started in time; default none
  }
}
```

A remote whose Server Actions read or change private data should set
`actions: { requireIdentity: true }`, so an action that someone forgot to wrap in
`requireIdentity()` is still refused without a token.

Server Action calls have no client-side timeout unless you set `actions.timeoutMs`: a call whose
response has not started within that many milliseconds is aborted and rejects with `NF-038`. The
action may still have run on the remote. The limit covers a retry after a token refresh too (one
deadline from the first request).

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
- **No Fast Refresh, no live reload in hosts.** `@vitejs/plugin-react` and `@vitejs/plugin-react-swc` are rejected with `NF-002`; Vite's built-in oxc compiles
  JSX. Fast Refresh code needs a preamble that only Vite-served pages have, so it cannot run inside
  a host. A host page is not connected to the remote's dev server either: after you edit an island,
  nothing changes until you reload the host page. A public island the host caches keeps its cached
  envelope for its `revalidate` (60 s by default) under `next dev` too: wait, call
  `revalidateIsland`, or give it a short `revalidate` in development.
- **Dev pre-bundling.** React (`react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`,
  `react-dom/client`) is pre-bundled when the dev server starts, and `@next-federation/island` is
  never pre-bundled (`optimizeDeps.exclude`: its `Form` and `Link` are loaded as files, and a
  pre-bundled copy would be a second instance). So the first host load against a cold optimizer
  cache does not make Vite re-optimize (Vite would ask the page to reload, which a host page never
  hears, and the island would load a second React). A package your islands' client components
  import that Vite discovers on that first load can still re-optimize: list it in
  `optimizeDeps.include` (but not a package with `'use client'` components of its own).
- **Browser console forwarding off.** Vite 8 can print browser console output in the dev server's
  terminal; for a remote that would be every host page's console, so the plugin sets
  `server.forwardConsole: false` unless your config sets it.
- **Server Actions reach client components as props.** A `'use server'` file imported by a client
  module (browser or SSR build) fails with `NF-034`; pass the action from a Server Component
  instead. A plain `<form action={action}>`, or a `formAction={action}` outside a `<Form>`, warns
  `NF-035`: use `<Form>` from `@next-federation/island`. In dev, the action route loads only files the server build has
  seen with `'use server'`.

## plugin-rsc version

Any version other than 0.5.39 fails with `NF-025`. A CI canary job may set `NF_ALLOW_PLUGIN_RSC=1`
to turn that into a warning while testing a newer plugin-rsc.

## Remote components

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
a module whose type graph reaches a secret. It uses the remote project's own TypeScript compiler
API: TypeScript 5 or 6 (TypeScript 7, the native compiler, has no compiler API: pin
`typescript@6` in the remote project). The optional `typescript` peer accepts any version from 5,
so a project on TypeScript 7 (create-vite's default) still installs with npm; only `types: true`
needs TypeScript 6. Without `typescript`, with TypeScript 7, when TypeScript cannot emit
them, or when a declaration names an absolute path or a path above the root, the build warns
(`NF-002`) and publishes no types.
`nextFederationComponents` applies to the whole Vite project: every module gets React and the
`shared` modules from the host, and `vite build` builds only the exposed modules. A page of that
project cannot run on its own (`createContext is not a function`), and the dev server warns `NF-002`
once when a browser opens one. To keep a standalone app, use two Vite configs: `vite.config.ts` for
the app (with `@vitejs/plugin-react`) and `vite.remote.config.ts` for the remote, built with
`vite build --config vite.remote.config.ts` into its own `outDir`
([Keeping a standalone app](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components.md#keeping-a-standalone-app)).

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

## Learn more

- [Writing an island remote](https://github.com/tariqule/next-federation/blob/main/docs/guides/writing-an-island-remote.md)
- [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components.md)
- [Limits](https://github.com/tariqule/next-federation/blob/main/docs/guides/limits.md)
- [Deployment](https://github.com/tariqule/next-federation/blob/main/docs/guides/deployment.md)

License: MIT
