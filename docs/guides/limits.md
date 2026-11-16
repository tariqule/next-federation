# Limits

What islands do not do, and what they cost. Read this before you choose between islands and a
different approach.

## Supported

React 19 (required). Next.js 16 App Router and Pages Router, with Turbopack or webpack, on Node 20.9
or newer (Mode A server rendering needs Node 20.16 or newer). React Router hosts come after 1.0. Remotes build with Vite 8 and `@vitejs/plugin-rsc` 0.5.39 (pinned; any
other version fails with `NF-025` unless `NF_ALLOW_PLUGIN_RSC=1` is set).

## What an island cannot do

- **Props are plain JSON.** No functions, `Date`, `Map`, class instances or cycles (`NF-009`).
- **React context does not cross into an island.** The island is a separate React tree. Pass what it
  needs as props.
- **No nested islands.** An island cannot embed another island.
- **No CSS isolation.** There is no Shadow DOM. Remotes scope their own class names.
- **Island CSS sorts after Next's CSS in the App Router.** Island stylesheets are React stylesheet
  resources in their own group (`data-precedence="next-federation"`), placed after Next's own group,
  so on equal specificity the island's rule wins. React does not manage a Pages Router or SPA host's
  own `<link>` tags: there a server-rendered island's stylesheet comes ahead of its markup in the
  body (after the host's `<head>` CSS), but one first inserted in the browser goes to the start of
  `<head>` (before it). Do not rely on order between host and island rules; scope class names. Each
  URL loads once per page, even when several islands list it.
- **A client-side mount does not wait for island CSS.** A server-rendered island's stylesheets come
  ahead of its HTML, so it never paints unstyled. An island that first mounts in the browser (a SPA,
  or a client navigation to a page with an island) inserts its stylesheets without holding the
  render: a slow or stalled stylesheet never holds the host's navigation, but the island can show
  unstyled until its CSS arrives.
- **Island metadata never reaches the host `<head>`.** `<title>`, `<meta>`, `<link>` and scripts are
  stripped from island HTML.
- **No Fast Refresh for islands inside a host.** Edits reload the page.
- **No Server Actions yet.** A `'use server'` module fails with `NF-019`.

## What a client component (Mode A) cannot do

- **Share only the host's React set and the modules the host declares.** `react`, `react-dom`,
  `react-dom/client` and `react/jsx-runtime` are always the host's. Every other module a remote lists
  in `shared` must be provided by the host (`createRemoteComponent({ shared })`); a missing one fails
  the load (`NF-029`, fallback). Remotes never bundle a shared module, and nothing is negotiated: the
  remote gets the host's copy whatever its version. A remote's `shared: { name: { requiredVersion } }`
  is passed to Module Federation as a singleton range; a mismatch only produces a Module Federation
  runtime warning, and the host's copy is still used.
- **No `next/*` modules.** Remotes are Vite builds; `next/link`, `next/navigation` and `next/image`
  are never shared. Pass callbacks or components as props.
- **No server rendering for unverified builds.** Only a signed or pinned build runs on the host's
  server; any other renders in the browser ([Client components](client-components.md#integrity-server-rendering)).
- **Stylesheets follow the island rules.** A server-rendered component's stylesheets come ahead of
  its markup (never unstyled) with modulepreload links for its chunks; one first mounted in the
  browser (client navigation, browser-only build, SPA) inserts them without waiting, so it can show
  unstyled until its CSS arrives. No CSS isolation: scope class names.
- **Remotes are `@module-federation/vite` builds** (`nextFederationComponents`). Rspack or webpack
  Module Federation remotes are untested.

## Trust

The host trusts the remote's HTML and scripts. Only configure remotes you trust.

- The host fetches envelopes only from the remote's origin and its `assetOrigins`. Bootstrap and CSS
  URLs outside that allowlist are refused (`NF-005`).
- Redirects are refused. A remote that redirects counts as a failed fetch.
- Stripping scripts from island HTML is cleanup, not a security boundary.
- `aud` in an identity token scopes it to one remote's server, not to one island in the browser
  ([Identity](identity.md)).

## Cost

<!-- numbers: Task 24 (measured 2026-11-16) -->
Measured in production builds (`docs/measurements.json`, written by `test/e2e/measure.spec.ts`), two
remotes on React 19.3.1, gzip:

- **About 75 KB of JavaScript per distinct remote without sharing** (`share: false`): React, React
  DOM, the RSC client and island code. Several islands from one remote share that cost.
- **Much less when remotes run the identical React version and share it** (the default in
  production builds). The first remote on a page brings React (78 KB, about 3 KB more than unshared);
  every further remote on the same React costs about 12 KB. Sharing is exact-version,
  production-only, and never includes the flight client, which stays per build. This holds on every
  host, App Router included: the islands share one React among themselves.
- **About 12 KB per remote when the host provides its React.** A SPA or Pages Router host that runs
  the same stable React can call `provideHostReact()` from `@next-federation/react/share`; then no
  remote downloads React. **App Router hosts never provide their React**: Next runs its own React
  build, so there the first remote still brings one copy.
- **Island HTML appears about three times in a host page** (the DOM, the envelope in the framework's
  embedded data, and the island's RSC payload, which encodes the same tree); **the RSC payload
  appears once**. This holds for the App Router (with and without `cacheComponents`) and the Pages
  Router. Keep islands small. The host warns in development above 100 KB per envelope (`NF-024`).
- **Each island costs a host-to-remote server hop.** Use caching, `preloadIsland` and co-locate the
  regions of host and remote.

## Cache and retention

A host cache that outlives the remote's build retention leads to `410 NF-023` and inert islands. See
[Caching](caching.md) and [Deployment](deployment.md).

## Other

- A remote must run its server in the same React mode as its client bundle.
- Remote assets need CORS headers; `nf-serve` and the island handler add them for the listed `hosts`.
- Mode A (client components, with SSR): see [Client components](client-components.md).
