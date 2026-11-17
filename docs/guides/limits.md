# Limits

What islands do not do, and what they cost. Read this before you choose between islands and a
different approach.

## Supported

React 19 (required). Next.js 16 or 15 (`>=15.5.28 <17`) App Router and Pages Router, with Turbopack
or webpack, on Node 20.9 or newer (server rendering of remote components needs Node 20.16 or newer).
React Router hosts come after 1.0. Remotes build with Vite 8 and `@vitejs/plugin-rsc` 0.5.39 (pinned; any other version
fails with `NF-025` unless `NF_ALLOW_PLUGIN_RSC=1` is set).

### Next.js 15

Islands and remote components work on Next 15 (React 19) the same way, App Router and Pages
Router, Turbopack (`--turbopack`) or webpack (Next 15's default). What is Next 16 only:

- **`cacheComponents`** (`'use cache'`, `cacheLife`, `cacheTag`, partial prerendering of islands).
  On Next 15 the adapter always uses the legacy model: island envelopes and descriptors are fetched
  with `next: { revalidate, tags }` ([Caching](caching.md#app-router-legacy-mode-no-cachecomponents)).
  `withNextFederation` fails with `NF-002` when `cacheComponents`, `experimental.cacheComponents`
  or `experimental.dynamicIO` is on with Next 15.
- **`revalidateIsland` expires at once** on Next 15 too, but through Next 15's one-argument
  `revalidateTag` (Next 16's profile argument does not exist there).
- **Next 15's `experimental.useCache`** is not checked: an island rendered inside your own
  `'use cache'` scope is cached with that scope, failures included.

Next 14 (React 18) is not supported: islands and remote components need React 19.

## What an island cannot do

- **Props are plain JSON.** No functions, `Date`, `Map`, class instances or cycles (`NF-009`).
- **React context does not cross into an island.** The island is a separate React tree. Pass what it
  needs as props.
- **Nested islands are not supported, but they are not blocked.** An island's server code can
  render another remote's island (it fetches that envelope itself, server to server), and it works,
  silently, with no warning. The inner island is outside everything the host gives an island: it
  gets no identity (the host's token is minted for the outer remote's audience, so a private inner
  island is refused with `401` and a public one renders anonymously), it sits outside the host's cache and tags (`revalidateIsland` on the host
  does not reach it) and outside its skew handling (the outer remote decides which build it gets),
  and it adds a second server hop to every render of the outer island. Embed each island from the
  host instead, side by side, and pass data between them as props.
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
- **Server Actions have no progressive enhancement.** `<Form>` stays disabled until the island has
  hydrated, and actions reach client components only as props (`NF-034` otherwise).

## What a remote component cannot do

- **Shared modules come from the host, unless the remote bundles a fallback.** `react`, `react-dom`,
  `react-dom/client` and `react/jsx-runtime` are always the host's, with no fallback. Every other
  module a remote lists in `shared` is host-provided by default: the host passes it with its real
  version (`createRemoteComponent({ shared })` or `registerSharedModules`). Before an exposed module
  loads, the host checks the shared modules that exposed module imports. A missing module, or a
  version outside the remote's `requiredVersion`, renders the fallback (`NF-036`); the remote's
  other components still load. With `fallback: true` the remote bundles its own copy and uses it
  when the host's copy is missing or does not satisfy the range. Do not use a fallback for a module
  whose identity matters, such as a context module. `react`, `react-dom`, `next` and their
  subpaths never fall back.
- **A satisfying host copy is seeded page-wide.** A fallback copy is looked up in
  `@module-federation/vite`'s module cache by its name and bundled version, and the host seeds its
  own copy under that key when it satisfies the range. In the browser the key is page-wide: any
  other `@module-federation/vite` app on the page that bundles the same version reads the host's
  copy, even when its own range is narrower. On the server it belongs to one router layer's runtime
  (never the process-wide cache), and every remote component of that layer shares it. If two
  remotes bundle the same version with different ranges, they share whichever copy loaded first.
  On the server, when a layer's cache holds under a fallback key another object than the host copy
  that satisfies the range (a bundled copy cached before the host registered its own, or a module
  registered again with another object), the layer moves to a new scope with an empty cache, so
  the server renders the host copy the browser seeds; at most 4 times per layer, then such a build
  renders in the browser only there (`NF-028`). A cache that holds another instance of a host
  module also renders browser-only.
- **A mixed-router host loads each remote build up to twice.** A host with App Router and Pages
  Router routes runs two Reacts in one server process. Each router layer loads, verifies and
  evaluates its own copy of a remote build's server code, so the server keeps up to `maxBuilds`
  builds of a remote per layer (up to twice as many in all). A remote's server entry never
  initialises in both layers at once: a layer waits at most 10 s for the other, then its load
  fails and is retried after the cooldown. Only `@module-federation/vite` 1.24.0 and
  `@module-federation/enhanced` 2.9.2 and 2.9.3 builds server-render in both layers; all other
  builds server-render in one layer per process, the first in which one of them evaluated. A
  build whose manifest lists `remotes` of its own, or that has no manifest the server loader could
  check, never server-renders (the host decides it when it fetches the build's descriptor, before
  any render: `NF-028` once). The layers are kept apart, not
  sandboxed: a verified remote runs with the host process's rights
  ([Remote components](remote-components.md#mixed-router-hosts)).
- **No top-level `let`/`const` named `document`, `window` or `self` in server chunks.** The
  server loader evaluates each server chunk inside a function whose parameters include
  `document`, `window` and `self` (always `undefined` in a router layer's scope), so a remote's
  code never reaches the real global through a server-side polyfill of them. A chunk that declares
  one of these names at its top level with `let` or `const` is then a `SyntaxError`: that build
  fails safe and renders in the browser only (`NF-029`). `var` and function declarations of these
  names are fine.
- **Register shared modules early.** Provide them at module scope, in a module every page imports
  (the root layout or `_app`). A module first registered after a remote component has loaded (for
  example by a page reached through a client navigation) makes the runtime start over for later
  loads with a new Module Federation instance. On the server, the remote's container is reused and
  initialised again with the new module. When a fallback copy cached earlier would shadow the
  host's, the layer moves to a new scope and evaluates the remote's code again, so those later
  loads do not share module state with the components loaded before.
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

## `next dev` and linked installs

In development, React records the values that Server Components await and sends them to the
browser as debug info. Next.js 15 inlines it in the App Router's HTML and RSC payload; Next.js 16
(checked on 16.4.6) sends it over the dev server's HMR websocket (`/_next/hmr`). Next's dev tooling
leaves code under `node_modules` out of it, using Node's source maps.

- **Installed from npm** (the library under `node_modules`), with Next's default dev source maps: a
  private island renders on the server in `next dev` exactly as in production, and none of its
  values reach the browser. This is tested on Next 15 and 16 under `next dev`, with Turbopack and
  webpack (`test/e2e/installed-dev.spec.ts`).
- **Linked** (a workspace package, `npm link`, a source checkout: the library outside
  `node_modules`, as when you develop next-federation itself): Next treats the library as your own
  code, so the debug info carries what it awaits for a private island: the request's cookies
  (HttpOnly ones included) and headers (`Authorization` too), what your `getIdentity` returns, and
  the minted island token. With Turbopack all of these reach the browser; with webpack on Next 16 we
  saw the token only. The host logs `NF-037` once per process when this applies.
- **Source maps disabled** (`next dev --disable-source-maps`): Next may not recognise the installed
  library either. With Turbopack and webpack on Next 15.5.28 and 16.4.6 no values reached the
  browser (also tested), but the host logs `NF-037` for this case too.
- **Production builds** never contain this debug info, linked or not.
- **Your own code** is always "your code" to Next: if your `getIdentity` awaits something (a session
  lookup, say), Next sends that value to the browser in development, as it does for any Server
  Component that awaits `cookies()` or `headers()`.

Why this is not gated: the token is minted for the same signed-in user, whose browser can already
get it from the token endpoint, and the cookie and header exposure comes from Next's own dev tooling
for any app that awaits `cookies()` or `headers()`. Keep the dev server on your machine: `next dev`
listens on every network interface (`0.0.0.0`) by default, so start it with `next dev -H 127.0.0.1`.

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
remotes on React 19.3.1. Every size below is **gzip on the wire**: `nf-serve` compresses JavaScript,
CSS, JSON and other text assets (brotli when the browser accepts it, which is smaller still; gzip
otherwise). Uncompressed, the same JavaScript is about three times larger (round 3 measured a first
island remote at 253 KB raw against 81 KB gzip). On any other static host or CDN, turn compression on
for these types, or these numbers do not hold ([Deployment](deployment.md#compression)).

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
  Router. Keep islands small. The host warns in development above 100 KB per envelope (`NF-024`)
  and refuses a response body above 5 MiB (`islands.maxBytes`, or a remote's `maxBytes`): the
  island fails with `NF-007` and renders its fallback, and the request is aborted at the limit.
  **Without `cacheComponents`, Next's fetch cache can read the whole body first**: public islands
  are fetched with `next: { revalidate, tags }`, and while Next prerenders or revalidates a page it
  buffers the full response (to store it) before the island fetch sees any of it. The body is still
  refused, but only after it was downloaded. With `cacheComponents`, and for private islands, the
  limit applies as the body arrives. To bound what the host downloads in every case, cap response
  sizes at the remote or at a proxy in front of it.
- **Each island costs a host-to-remote server hop.** Measured in validation round 3 (a laptop, remotes
  on localhost): about 2 to 15 ms at the median per envelope from a co-located remote (2 to 7 ms for
  most islands and descriptors on an idle host, 15 ms for a private island on a host under load), and
  9 to 22 ms at p95. A remote in another region adds its network round trip to that. The island
  timeout (`islands.timeoutMs`, 3 s by default) bounds the worst case: a slow remote never holds a
  render longer than the timeout, after which the island renders its fallback (`NF-008`). A cached
  public island costs no hop until its entry is revalidated. Use caching, `preloadIsland` and
  co-locate the regions of host and remote.

## Cache and retention

A host cache that outlives the remote's build retention leads to `410 NF-023` and inert islands. See
[Caching](caching.md) and [Deployment](deployment.md).

## Other

- A remote must run its server in the same React mode as its client bundle.
- Remote assets need CORS headers; `nf-serve` and the island handler add them for the listed `hosts`.
- Remote components (client components, with SSR): see [Remote components](remote-components.md).
