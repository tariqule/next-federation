# Limits

What islands do not do, and what they cost. Read this before you choose between islands and a
different approach.

## Supported

React 19 (required). Next.js 16 App Router and Pages Router, with Turbopack or webpack, on Node 20.9
or newer (server rendering of remote components needs Node 20.16 or newer). React Router hosts come
after 1.0. Remotes build with Vite 8 and `@vitejs/plugin-rsc` 0.5.39 (pinned; any other version
fails with `NF-025` unless `NF_ALLOW_PLUGIN_RSC=1` is set).

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

## What a remote component cannot do

- **Shared modules come from the host, unless the remote bundles a fallback.** `react`, `react-dom`,
  `react-dom/client` and `react/jsx-runtime` are always the host's, with no fallback. Every other
  module a remote lists in `shared` is host-provided by default: the host passes it with its real
  version (`createRemoteComponent({ shared })` or `registerSharedModules`). Before an exposed module
  loads, the host checks the shared modules that exposed module imports. A missing module, or a
  version outside the remote's `requiredVersion`, renders the fallback (`NF-036`); the remote's
  other components still load. With `fallback: true` the remote bundles its own copy and uses it
  when the host's copy is missing or does not satisfy the range. Do not use a fallback for a module
  whose identity matters, such as a context module. React and `next/*` never fall back.
- **A satisfying host copy is seeded page-wide.** A fallback copy is looked up in
  `@module-federation/vite`'s module cache by its name and bundled version, and the host seeds its
  own copy under that key when it satisfies the range. The key is page-wide (process-wide on the
  server): any other `@module-federation/vite` app on the page that bundles the same version reads
  the host's copy, even when its own range is narrower. If two remotes bundle the same version with
  different ranges, they share whichever copy loaded first. A server process that hosts more than
  one React (an App Router and a Pages Router route), or whose share cache holds another instance
  of a host module, never seeds: there the remote always uses its bundled copy.
- **Register shared modules early.** Provide them at module scope, in a module every page imports
  (the root layout or `_app`). A module first registered after a remote component has loaded (for
  example by a page reached through a client navigation) makes the runtime start over for later
  loads. On the server, the remote's code is then evaluated again for those later loads, so they do
  not share module state with the components loaded before. The earlier instance's evaluated
  graphs stay in memory as long as the components loaded from it, and `maxBuilds` does not count
  them: it counts builds, not instances.
- **Only three `next/*` modules.** `next/link`, `next/navigation` (App Router) and `next/router`
  (Pages Router) come from the host's router, through `@next-federation/next/components` or
  `@next-federation/next/pages/components`. An SPA provides none. `next/image`, `next/head` and the
  rest cannot be shared (`NF-002` at build time); pass what the component needs as props.
- **No checks against a remote dev server.** A dev server's descriptor lists no shared modules, so
  a missing module fails only when the remote's code asks for it (`NF-029`).
- **No server rendering for unverified builds.** Only a signed or pinned build runs on the host's
  server; any other renders in the browser ([Remote components](remote-components.md#integrity-server-rendering)).
- **Stylesheets follow the island rules.** A server-rendered component's stylesheets come ahead of
  its markup (never unstyled) with modulepreload links for its chunks; one first mounted in the
  browser (client navigation, browser-only build, SPA) inserts them without waiting, so it can show
  unstyled until its CSS arrives. No CSS isolation: scope class names.
- **Rspack and webpack remotes get coarser checks.** `nf-describe` reads the shared modules from
  `mf-manifest.json`, with no per-expose list, so every exposed module is checked against every
  host-provided module the build shares. A fallback copy there is chosen by the remote's own
  Module Federation runtime. Rspack remotes are tested; webpack remotes are documented but
  untested ([Remote components](remote-components.md#remotes-built-with-rspack-or-webpack)).

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
- Remote components (client components, with SSR): see [Remote components](remote-components.md).
