# Design: next-federation, framework-agnostic UI federation (Next.js first)

Date: 2026-11-13 · Status: approved (rev. 4, after the Phase 0 spike and two independent reviews) · Name: **`next-federation`**

## 1. Intent

`@module-federation/nextjs-mf` is in maintenance mode and will leave CI around the end of 2026
(module-federation/core#3153). It never supported the App Router: it throws on any `app/`
directory (`module-federation/packages/nextjs-mf/src/plugins/NextFederationPlugin/index.ts:143-149`).
Teams on Next.js 16 have no supported, production-ready way to compose UI from separately deployed
apps at runtime. The closest prior art (§2a) is either work in progress built on Next internals, or
client-only.

`next-federation` is an **open-source** successor with a **fresh API**. It:

- works in Next.js 16 with **both App Router and Pages Router**;
- lets remotes ship **real React Server Components in v1**, shown in the host as **islands**;
- has a **framework-agnostic core**, with **React Router** as the first adapter after v1.0;
- **survives future Next.js and React Server Components changes**, because it uses no Next internals and
  waits on no upstream changes;
- deploys on **Vercel and self-hosted Node alike**.

### Why nextjs-mf died (the lesson this design is built around)

It depended on at least 12 Next.js private internals: compiler names, the `.next` output layout, the shape
of Next's externals function, loader names, `require.cache` flushing, and more. Each Next release cost its
maintainers roughly 6 weeks of fixes (per #3153). **Core rule: never depend on a Next.js private
internal.** Framework knowledge lives only in small adapters that use public APIs.

## 2. Verified background (checked 2026-11-13 against Next.js 16.5.0-canary.49 source and npm)

| Fact | Source |
|---|---|
| Turbopack is the default bundler for `next dev` and `next build` | `nextjs/packages/next/src/lib/bundler.ts:106-110` |
| Turbopack has no JS plugin API; it accepts webpack-style loaders via `turbopack.rules` | `nextjs/packages/next/src/server/config-shared.ts:150-307` |
| Turbopack honours `/* turbopackIgnore: true */` (and `webpackIgnore`) on `import()` | `nextjs/turbopack/crates/turbopack-ecmascript/src/references/mod.rs:1882` |
| Next's App Router uses its own vendored React, currently `19.3.0-canary-df6aa4ec-20261112`; latest stable React on npm is `19.3.1` | `nextjs/package.json` (`react-builtin`); `npm view react` |
| An app can run up to 4 React copies: vendored RSC, vendored SSR, compiled browser, and `node_modules` React for Pages Router on the server | `nextjs/packages/next/src/build/create-compiler-aliases.ts:394-530`, `handle-externals.ts` |
| App Router Route Handlers are compiled with the `react-server` condition (`react-dom/server` throws there) | `nextjs/crates/next-core/src/next_server/context.rs:112-121`, `nextjs/packages/next/src/compiled/react-dom/server.react-server.js` |
| `connection()` (`next/server`) is **not** an island-scoped opt-out. Without `cacheComponents` it interrupts static generation for the **whole route**. It throws inside `'use cache'` / private cache. | `nextjs/packages/next/src/server/request/connection.ts:56-63, 97-100` |
| `cacheComponents` is a top-level config flag. `next/cache` exports `cacheLife` and `cacheTag` (stable names). | `nextjs/packages/next/src/server/config-shared.ts:2230`; `nextjs/packages/next/cache.d.ts` |
| With `cacheComponents`, the layout router keeps previously visited routes mounted inside a hidden `<Activity>`. Hidden Activity runs effect cleanups but keeps the DOM. | `nextjs/packages/next/src/client/components/layout-router.tsx:586-590, 744-751` |
| App Router StrictMode is on by default in development (double-invokes effects) | `nextjs/packages/next/src/build/define-env.ts:305-306`, `src/client/app-index.tsx:402` |
| App Router `router.push` and Pages Router `router.push` both add `basePath` themselves | `nextjs/packages/next/src/client/components/app-router-instance.ts:285`; `src/shared/lib/router/router.ts:116,144` |
| Next treats multipart/urlencoded POSTs to app pages as possible Server Actions and rejects unknown action IDs with **400 or 409** | `nextjs/packages/next/src/server/lib/server-action-request-meta.ts:36-47`; `src/server/app-render/action-handler.ts:98-100` |
| Native Module Federation for Turbopack is in progress (PRs #97625, #97630, #99134, #99144), **all open/unmerged**, browser only. Not relied on. | GitHub, checked 2026-11-13 |
| MF 2.0 runtime is bundler-agnostic, v2.9.3: `createInstance`, `loadRemote`, `registerRemotes`, `registerShared`, `preloadRemote`, `registerPlugins` | `module-federation/packages/runtime/src/index.ts` |
| `@vitejs/plugin-rsc` v0.5.39 (**0.x**). React Router 8.5.1 uses it for RSC mode (an *optional* peer of `@react-router/dev`) | `npm view` |
| plugin-rsc's browser runtime keeps state in page-wide globals (`globalThis.__vite_rsc_client_require__`, `globalThis.__viteRscCallServer`); two copies on one page collide. The flight client is pre-bundled outside the app's module graph in dev, so a true module-scoped binding is impossible; scoping is done with one registry global keyed per build (§6). | `@vitejs/plugin-rsc@0.5.39` `dist/shared-*.js`, `dist/react/browser.js` |
| plugin-rsc builds asset URLs as `config.base + url` and rejects a relative `base` for RSC | `@vitejs/plugin-rsc@0.5.39` `dist/plugin-*.js` |
| `@module-federation/vite` v1.24.0 emits ESM SSR entries and has `experiments.ssrMode: 'ISLAND'` (client-component islands that refuse to share `react`) | `@module-federation/vite@1.24.0` README/types |
| Vercel Deployment Protection (Standard) requires auth on generated deployment URLs, so they can't serve public assets to end users. **Per Vercel docs; not verified by the spike. Verified in Phase 5 on a real deployment.** | vercel.com/docs/deployment-protection |
| No production-grade federated React Server Components exist (MF core PRs #4247, #4467, #3736 closed unmerged) | GitHub |
| `'use cache'` only compiles when `cacheComponents` is on, so the caching implementation must be selected at build time | Phase 0 spike (`spike/host-app/next.config.ts`) |
| Production SSR emits `<link rel="modulepreload">` and React's inline form-replay `<script>`; dev does not | F6 |
| plugin-rsc 0.5.39 wires only the first `import.meta.viteRsc.loadCss()` call per module in builds | F8 |
| A development-mode RSC server sends debug rows a production flight client rejects (React error 504) | F9 |
| plugin-rsc's server runtime keeps process-wide state: two builds cannot share one process | F10 |
| Vite's dev and preview servers answer CORS preflights themselves, hiding handler CORS bugs | F11 |
| Vite's dependency pre-bundle cache does not notice plugin changes | F14 |
| Measured: ~76 KB gzip of JS per distinct island remote; island HTML appears ~3× in a host page | Gates f, h |

### 2a. Prior art to study in Phase 0
- **Vercel `remote-components`** (npm 0.4.16, repo `vercel/microfrontends`, peer `next >=15`). It has hosts for App
  Router, Pages Router and plain React, and a remote for Next App Router. It is labelled work in progress, uses
  Next internals (`__RSC_MANIFEST`, `__next_require__`) and Shadow DOM. It proves demand, and shows the cost of
  exposing a Next `app/` remote.
- **`@module-federation/vite` `ISLAND` mode:** client-component islands with their own React. A candidate to
  reuse for island asset loading.

## 3. Goals, non-goals, anti-goals

### Goals (v1.0)
1. A host on **Next.js 16, either App Router or Pages Router, with Turbopack or webpack**, renders UI from separately
   deployed remotes.
2. **Real Server Components in remotes:** async server components, server-only code and secrets, `'use client'`
   children, and Server Actions run on the remote. They are shown in the host as **server-rendered, hydrated
   islands** (Mode B).
3. **Remote client components (Mode A), browser-rendered in v1.0:** they render inside the host's tree and share
   context. The host server-renders a skeleton for them.
4. Islands can show **per-user content on the server** for remotes on **any origin**. Links inside islands
   **navigate the host client-side**.
4a. **Island remotes on the same exact React version share one copy of React** on a page (shared scope `nf-islands`), falling back to their own copy on any mismatch. Conditional on the Phase 2 proving gate; if the gate fails, islands ship without sharing and this returns to the deferred list.
5. **One API style** for App Router and Pages Router.
6. **No host bundler plugin, loader or extra build step. One required config wrapper:** a Next host wraps its `next.config` with `withNextFederation()`. The wrapper uses public config keys only (`env`, `turbopack.resolveAlias`, `webpack` alias, `transpilePackages`) to select the island caching implementation that matches `cacheComponents` and to expose `basePath`. The adapter fails with a clear error (`NF-017`) if the wrapper is missing.
7. **Survives upgrades:** a new Next minor needs no change outside the Next adapter, and ideally none at all.
8. A remote that is down, slow or misbehaving shows a fallback. It never breaks the page and never breaks a
   static page's caching.
9. TypeScript types for remote modules and island props.
10. Open-source quality: docs, examples, semver and a published support matrix.

### Deferred to after v1.0 (planned, not dropped)
- **React Router adapter** (first post-1.0 release).
- **Mode A server-side rendering**, gated on integrity verification and a memory/update policy (§6 Mode A).
- Hosts that use **both routers at once** with Mode A server rendering.
- An optional host **import-rewriting loader** (`import X from 'remote/X'`).
- Intercepting **plain `<a>` clicks** in islands. v1.0 navigates only through the explicit `<Link>`.
- Streaming *inside* an island across the host; Rspack RSC remotes.
- The **fetched** payload transport (decided in Phase 5 from measurements; v1 of the protocol embeds the payload).
- Dev warnings that need to know whether a route is static (not detectable with public APIs).
- Fast Refresh for island and Mode A modules while they run inside a host.

### Non-goals
- **In-tree federated Server Components**, meaning remote server components mixed into the host's own RSC tree.
  They need Next internals. Nothing waits on upstream support for them.
- Route-level splitting (multi-zones and `@vercel/microfrontends` cover it).
- Next.js < 16, React < 19, non-React frameworks, and the Edge runtime in the host.
- Forms that work without JavaScript inside islands.
- Islands nested inside other islands.

### Anti-goals (failure even if it "works")
- Importing from `next/dist/...` or touching undocumented Next globals (`__RSC_MANIFEST`, `__next_require__`,
  `__next_f`, compiler names, `.next` layout).
- Forcing `--webpack` or `next-rspack`.
- Patching `require.cache` or monkey-patching React.
- Coupling island remotes to the host's React version or channel.
- **Silently making a static/ISR page dynamic**, or silently freezing an island into a static page.
- Running network-fetched remote code inside the host's server process without integrity verification.
- Exposing identity tokens in HTML, prerendered output or Next's RSC payload.
- Deriving a JWKS URL, or any URL, from the content of an unverified token.
- Importing an envelope's `bootstrap` or `css` URL that is outside the configured remote's origins.

## 4. Constraints
- **TypeScript everywhere** (user decision). Rust was rejected: SWC plugins break across hosts' pinned `swc_core`
  versions and don't run in Vite, esbuild or Rolldown.
- **Mode A** uses the MF 2.0 runtime and `mf-manifest.json`.
- **Mode B** uses React's RSC APIs (`react-server-dom-webpack` and its bundler-integration contract, the
  `__webpack_require__` free variable) plus `@vitejs/plugin-rsc` for the remote's server and SSR build. plugin-rsc
  is 0.x, so `@next-federation/vite` pins `@vitejs/plugin-rsc` to an exact version (0.5.39), refuses any other (`NF-025`), and confines all plugin-rsc touchpoints to one directory (`packages/vite/src/plugin-rsc/`), enforced by lint. The island protocol itself is bundler-neutral — HTML, RSC payload, a bootstrap module URL and a `buildId` — so a remote can later be built with Rspack; the Vite tooling is one implementation. **This is the main maintenance risk.**
- **Public Next APIs only.** The adapters may use:
  - `fetch` with `next: { revalidate, tags }`;
  - `'use cache'`, `cacheLife`, `cacheTag` and `revalidateTag`;
  - `cookies()` and `headers()`;
  - `next/navigation` and `next/router`;
  - Route Handlers and Pages API routes;
  - `getServerSideProps` and `getStaticProps`.
  - `unstable_rethrow` from `next/navigation` (so the adapter never swallows Next's control-flow errors); `next/head`; `next.config` keys `env`, `turbopack.resolveAlias`, `webpack`, `transpilePackages`.

  The adapters must **not** call `connection()` (§2).
- **Vercel and self-hosted Node**, with no platform APIs in core.
- Published packages support and are CI-tested on Node ≥ 20.9. Developing this repository (tooling, fixtures, e2e) requires Node ≥ 24; that is a contributor requirement, not a user one.
- Island React sharing uses the MF 2.0 runtime's share scopes (`@module-federation/runtime`), in the browser only.

## 5. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ Host adapters (public framework APIs only)                             │
│   @next-federation/next         App Router + Pages Router (v1.0)       │
│   @next-federation/react-router (after v1.0)                           │
├────────────────────────────────────────────────────────────────────────┤
│ Remote tooling                                                         │
│   @next-federation/vite         remote build: islands (wraps           │
│                                 @vitejs/plugin-rsc) + Mode A exposes   │
│                                 (wraps @module-federation/vite)        │
│   @next-federation/server       framework-free island handler          │
│                                 (Web Request → Response)               │
│   @next-federation/server/node  Node listener and multi-build          │
│                                 server `nf-serve` (new)                │
│   @next-federation/island       remote-side helpers: <Link>,           │
│                                 getIdentity(); <Form> (Phase 3)        │
│   @next-federation/island/bootstrap                                    │
│                                 browser bootstrap runtime (new),       │
│                                 bundler-neutral                        │
├────────────────────────────────────────────────────────────────────────┤
│ Core (framework-free TypeScript)                                       │
│   @next-federation/core         registry, island fetch (timeouts,      │
│                                 retries), identity token minting,      │
│                                 events. The MF runtime instance and    │
│                                 manifests arrive with Mode A (Phase 4).│
│   @next-federation/react        RemoteComponent, IslandMount,          │
│                                 error boundary                         │
│   @next-federation/protocol     island protocol types + versioning     │
│   @next-federation/sdk          logger, numbered error codes (NF-###)  │
└────────────────────────────────────────────────────────────────────────┘
```

The rule: `core`, `react`, `protocol`, `server` and `island` import no framework. Package names and layout are otherwise the builder's call.

## 6. Two federation modes

### Mode A: remote client components (browser-rendered in v1.0)
The host loads a remote's module through the MF runtime **in the browser** and renders it inside the host's React
tree.

- **Use for:** interactive widgets that must share context or state with the host. Props may include functions
  and children.
- **In v1.0** it renders only in the browser, under a host `<Suspense>`. On the server, `RemoteComponent`
  renders its `fallback` (a skeleton). In App Router it is used from a `'use client'` file.
- **Runtime imports** of remote code carry `/* webpackIgnore: true */` and `/* turbopackIgnore: true */`, so the
  host bundler never tries to resolve them (§2).
- **React sharing:** §7.
- **Remote builds:** `@next-federation/vite` (wraps `@module-federation/vite`). MF 2.0 remotes from Rspack or webpack
  also work if they emit `mf-manifest.json`.
- **Mode A server rendering is deferred to after v1.0** (decided after review). It means running remote code fetched
  over the network inside the host's server process. A compromised remote CDN would then mean code execution with
  the host's secrets, and Node cannot unload ESM, so each picked-up remote version leaks memory. Prerequisites to
  ship it later:
  1. integrity verification, either hashes pinned in host config or a signed manifest;
  2. a documented update policy (pinned per host deploy versus hot pickup) with a memory bound;
  3. the per-React-environment isolation from rev. 2 of this design (distinct entry global names), and the
     React shims for host-provided React.

### Mode B: RSC islands (real Server Components in remotes)
The remote renders **real React Server Components in its own process**, does its own SSR, and returns the result.
The host shows it as an **island**: a separate React root with **its own React**.

#### Remote side
- Islands are built with `@next-federation/vite` (wraps `@vitejs/plugin-rsc`). They can use async components,
  server-only modules and secrets, `'use client'` children, and Server Actions.
- The output is a **framework-free fetch handler** (`@next-federation/server`). **Recommended deployment: its own
  service** (Vercel Function, Node server). Mounting it inside an existing Next app is not supported in v1.0:
  its built output contains React built for the `react-server` condition, which must not be re-bundled by Next.
- **Next apps do not expose `app/` components as islands** (user decision). A Next team adds a small
  `@next-federation/vite` island build next to its app (same repo, separate deploy). The docs include a "sharing
  components from a Next app" guide.
- **Island rules:** Hoistables and scripts are removed at the source where possible (`rscCssTransform: false`) and otherwise stripped from the island HTML by a **tokenizer** in the remote handler, in dev and production (F6, R). In dev the handler warns (`NF-018`) for anything it strips that is not known framework output. This is cleanup, not a security boundary: hosts accept envelopes only from allowlisted origins. Additional rules: **one stylesheet hook per island module**, injected by the plugin (F8); **island modules are excluded from Fast Refresh**, so `@vitejs/plugin-react` must not be added to an island build (F5); **Server Actions must be passed from the server component to client components as props** — a client module importing a `'use server'` module is flagged at dev time (F2, Phase 3).

#### Island protocol (`@next-federation/protocol`, versioned; wire format fixed in Phase 1 and documented)
- **Request:** `GET` with the island id and JSON props encoded in the URL, so it is CDN-cacheable. `POST` is the
  fallback above a size limit (builder sets it), and is cached only by the library's own cache. Optional
  `Authorization: Bearer <identity token>` (§9a). No cookies. The request also carries the **host context** (`basePath`, `locale`) as a second parameter, so `<Link>` renders full hrefs during remote SSR and the context is part of the cache key. Props are serialised as canonical JSON (sorted keys) so equal props share a cache entry.
- **Response:**
  - `protocolVersion`, `remote`, `buildId`;
  - `mode` (`development` | `production`): the React mode of the server that rendered. The bootstrap refuses an envelope whose mode differs from its own (`NF-006`) (F9);
  - server-rendered **HTML**;
  - the **RSC payload**;
  - CSS URLs and the bootstrap module URL, all **absolute and build-pinned** (F3);
  - the remote React version;
  - `idPlaceholder`: a token the host replaces with a per-mount `useId` prefix (R);
  - cache metadata (`Cache-Control`; private if a token was presented).
- **Unknown major `protocolVersion`:** fallback plus a logged error.
- **Hosts validate the envelope's URLs**: `bootstrap` and every `css` URL must be on the remote's configured origin or one of its declared asset origins, else the island shows its fallback (`NF-005`) (R).
- **Payload transport to the browser.** Measured: island HTML appears about 3× per host page (DOM plus Next's embedded data); the RSC payload count could not be measured reliably (F12). **Protocol v1 embeds the payload.** Hosts warn in development above 100 KB per envelope (`NF-024`). A fetched transport is an additive protocol change, decided in Phase 5 from a repeat measurement.
- **Bootstrap module contract.** The bootstrap URL points at an ES module exporting `mountIsland(container, options)` returning `{ update, destroy }`. This contract, with the envelope, is the whole protocol; it is published as `docs/protocol/v1.md`. A bootstrap must be safe next to other remotes' and other builds' bootstraps on one page.

#### Build pinning and deploy skew
- Asset and action URLs are **absolute and pinned to the build that rendered the island**. plugin-rsc requires an
  absolute `base` (§2).
- **On Vercel:** use the remote's **production domain** plus **Vercel Skew Protection** to pin the deployment. Do not use
  generated deployment URLs, which Deployment Protection puts behind auth (§2). The exact pinning mechanism (the
  deployment id on asset and action requests) is confirmed in Phase 0. Not verified by the spike; verified in Phase 5 (G).
- **Self-hosted:** versioned paths for assets **and handlers**. Each retained build's **server** keeps running, **in its own process** (F10), because islands post to the build that rendered them and plugin-rsc's server runtime is process-wide. `nf-serve` implements this. **Retention policy:** the current build, the newest 3 builds, and any build younger than 24 h stay live; retired builds answer `410` (`NF-023`) and their islands stay visible but inert. Operators keep builds for at least the longer of the host's island cache lifetime and the longest expected open tab (R).
- Cache keys include `buildId`. When a host re-render delivers an island from a **different `buildId`** than the one
  loaded, the mount **tears the island root down and re-bootstraps it** from the new HTML and bootstrap. This is the
  one case where island HTML is replaced. The same applies when the **bootstrap URL** changes with an unchanged `buildId`. Hydration always uses the envelope the frozen HTML came from, then applies the newest (review fix).

#### Host side: Next App Router
- `<RemoteIsland>` is an async Server Component. **It always sits in its own `<Suspense>` boundary**: the component
  adds one itself if the user doesn't. A hydration mismatch elsewhere in the host therefore can't client-render the
  island's DOM away.
- **Caching follows the host's caching model.** `withNextFederation()` reads `cacheComponents` from the host's config and selects the matching implementation at build time. The adapter **never calls `connection()`**, and fails with `NF-017` if the wrapper is missing.

  | | Public island (no identity) | Private island (identity token) |
  |---|---|---|
  | **Without `cacheComponents`** | `fetch(..., { next: { revalidate, tags } })`, so the page stays static/ISR | needs `cookies()`/`headers()`, so the route is dynamic. This is documented. (No dev warning: whether a route is configured static is not visible through public APIs.) |
  | **With `cacheComponents`** | rendered inside `'use cache'` with `cacheLife` + `cacheTag` | a dynamic hole under `<Suspense>`. Identity is read *outside* any cache scope; tokens are never minted inside `'use cache'` |

  - Defaults: public islands use `revalidate` from config. `dynamic: true` on a public island is an explicit opt-in, documented as making the route dynamic (or a dynamic hole with `cacheComponents`).
  - Tags are `nf:<remote>` and `nf:<remote>:<island>`. `revalidateIsland(remote, island?)` wraps `revalidateTag`,
    and the docs show a remote-deploy webhook that calls it.
- **CSS:** the host renders the island's CSS URLs as `<link rel="stylesheet" href precedence="next-federation">`
  **through the host's React**. That gives deduplication, no flash of unstyled content on soft navigation, and
  Suspense reveal that waits for styles.
- `preloadIsland(remote, island, props)` starts the island fetch early, e.g. in a layout, to cut server
  waterfalls.
- A failed or timed-out island fetch is **never cached** under `'use cache'` (the cached function throws; the caller turns that into the fallback).
- `fallback` is the loading state; `errorFallback` (default: `fallback`) is shown when the remote is down, slow, returns an invalid envelope, or the user is anonymous on a private island.
- Every `catch` in the adapter rethrows Next's control-flow errors first (`unstable_rethrow`).
- `revalidateIsland` expires the tag immediately (`revalidateTag(tag, { expire: 0 })`), for deploy webhooks.

#### Host side: Next Pages Router
- `getIslandProps()` for `getServerSideProps` (dynamic and private islands) and `getStaticProps` (public islands with
  `revalidate`). Its result goes to the same mount component. CSS links are rendered by the host.
- `getIslandProps(ctx, spec)` returns a JSON-serialisable object (`envelope`, `host`, `token` endpoint info) that is spread into `<RemoteIsland>` from `@next-federation/next/pages`. Private islands require `getServerSideProps`.

#### Island mount (`@next-federation/react`): lifecycle rules
1. **Server:** renders a container element with the island HTML (`dangerouslySetInnerHTML`) and a unique
   `identifierPrefix`. The remote renders with a placeholder prefix; the host mount replaces it, in the HTML and the payload, with a prefix derived from the host's own `useId()`. The prefix is therefore **unique per mount, not per props**: two identical islands on one page do not collide (R).
2. **Browser, first hydration:** dynamically imports the island's bootstrap from the remote origin, then calls
   `hydrateRoot` on the container with the RSC payload, **using the island's own React**.
3. **The island root is keyed to the container DOM node**, held in a module-level `WeakMap`, **not to the effect**.
   Effect cleanup **never** calls `root.unmount()`. As a result:
   - StrictMode's double effects are harmless;
   - Activity hide/show (Cache Components keeps routes alive in hidden `<Activity>`, §2) preserves the live island.
4. **Teardown** happens only when the container node is gone. This is detected by a deferred check after effect cleanup and by a sweep on every mount pass. (No `MutationObserver`; the spike proved this is sufficient, including toggling during bootstrap.)
5. **Container swap:** if the host replaced the container node (remount, key change, error-boundary reset,
   `template.tsx`, a host Suspense client-render), the mount detects the new node and **re-bootstraps** the island
   there.
6. **HTML is written only on first render.** Later host re-renders (soft navigation, `router.refresh()`, host Server
   Actions) deliver the new island result through the host's render. The mount applies **only the new RSC payload**
   via `root.render(...)`. The browser never refetches from the remote for host-driven updates. The exception is a
   `buildId` change (see above).
7. **Errors inside the island root** do not reach host error boundaries, because it is a separate root. The mount
   wires `onUncaughtError`, `onCaughtError` and `onRecoverableError` of `hydrateRoot` into the library's fallback
   and event API. Host StrictMode and the Next dev overlay don't cover island internals, and the docs say so. An uncaught error tears the island root down and shows `errorFallback`. A bootstrap that fails to load, a React-mode mismatch or a build mismatch leaves the server HTML in place and marks the island **inert**. Events are also dispatched as a bubbling DOM `CustomEvent('nf:island')` on the container, because functions cannot cross the App Router server/client boundary.

#### Multiple islands and remotes on one page (no colliding globals)
Islands **do not use plugin-rsc's browser runtime** (page-wide globals, §2). `@next-federation/vite` builds a
per-remote bootstrap that:
- bundles `react-server-dom-webpack/client` with its module-loading globals rewritten, at build time and in Vite's dependency optimizer, to **one registry entry per build**: `globalThis.__nf_rsc__[<the build's absolute base URL>]`. This is collision-free across remotes **and across two builds of one remote** on a page, but it is one page global, not zero. The optimizer cache directory is named after a hash of the key (F14). The bootstrap keeps its exports in production builds (F7). As a safety net the bootstrap refuses an envelope from another remote or build (`NF-010`); the client-reference-id prefix from the prior-art study is not implemented.;
- passes **`callServer` per island root** via `createFromReadableStream` options, so each action response
  re-renders its own island.

#### Shared React across island remotes
Island remotes share `react` and `react-dom` (with `react-dom/client`, `react/jsx-runtime`, and any libraries a remote declares) through a Module Federation share scope named **`nf-islands`**. It is separate from the host's Mode A scope, because an App Router host runs Next's canary React and must never mix with islands.
- Entries are **singletons with strict, exact-version matching**. The RSC wire format is only guaranteed between identical React versions, and the envelope already carries `reactVersion`.
- **On a mismatch a remote uses its own bundled copy.** It still works; there is just no saving. Sharing never couples a remote to the host's React version or channel (anti-goal unchanged).
- **The RSC flight client (`react-server-dom-webpack/client`) is never shared.** Each build keeps its own copy and its per-build registry slot; it imports `react`/`react-dom` from the shared scope.
- **A host on the same stable React may provide its React** into `nf-islands` (`provideHostReact()`): Pages Router and SPA hosts. App Router hosts never do.
- Production builds only; dev remotes do not share.
- Cost: ~76 KB gzip per distinct remote without sharing (spike). Target with sharing: first remote ≤ 84 KB, each further same-React remote ≤ 30 KB.
- **Conditional on a Phase 2 proving gate** (two same-React remotes → exactly one React download; mismatched versions → both work with separate copies; existing collision and skew tests still pass). If the gate fails, islands ship without sharing, as in the spike, and sharing moves to after v1.0.

Island remotes ship their own React unless they can share an identical version (see Shared React). The page then carries one more third-party global, the MF runtime's `__FEDERATION__`.

#### Server Actions in islands
- Each island's `callServer` posts to its **own remote's** build-pinned action endpoint, with
  `Authorization: Bearer` (§9a) and no cookies. CORS allows only configured host origins (never `*`), allows
  `Authorization`, and sets `Access-Control-Max-Age` to amortise preflights. The remote checks `Origin` against its
  host allowlist.
- **Forms before hydration:** islands hydrate late, after the host plus a cross-origin module load. A native submit
  would POST to the host page, which Next rejects (400/409, §2). So **island forms are not submittable until the
  island hydrates.** `@next-federation/island`'s `<Form>` renders its controls inside a disabled `<fieldset>` on the
  server and enables it after hydration. The dev check flags raw `<form action={serverFn}>` in islands. Phase 0 must
  confirm this blocks implicit (Enter-key) submission too.
- Actions reach client components **as props** from a server component. A client module that imports a `'use server'` module would get plugin-rsc's page-global `callServer`; a dev check flags it.
- CORS allows `Authorization`, `Content-Type` and `X-NF-Action`, and CORS headers are sent on error responses too.
- The action endpoint has a per-island 'requires identity' gate, a body size limit, and answers malformed input with 400, not 500.
- Until Phase 3 ships, an island build that contains `'use server'` fails with `NF-019`.

#### Navigation bridge
- The mount gives each island root a bridge: `navigate(href)` and `prefetch(href)`, implemented with
  `next/navigation` (App Router) or `next/router` (Pages Router).
- Remotes use `@next-federation/island`'s `<Link>`. It renders a real `<a href>` (works before hydration, new tab,
  modifier-clicks) and calls the bridge on plain clicks. **Plain `<a>` interception is deferred.**
- **basePath and locale:** the host sends `basePath` and `locale` with every island request (protocol host context), so `<Link>` renders the full href on the remote's server. Island authors write host-relative hrefs (`/orders/1`) and never handle the prefix themselves. Because both routers' `push` add `basePath` themselves (§2), **the bridge strips `basePath` before calling
  `push`**, to avoid a double prefix. Proven in Phase 0 for both routers (gate e2).

#### CSP
- The host's CSP must list remote origins in `script-src`, `connect-src` and `style-src`. Docs cover `'strict-dynamic'`:
  the bootstrap is loaded by host script, so it is trusted transitively.
- Island HTML contains no scripts. Embedded payloads travel inside Next's own nonce'd scripts, so no nonce plumbing is
  needed for them. If a nonce is needed, the host passes it explicitly. The library does not read headers to find it,
  which would make renders dynamic.

#### Honest limits (documented)
- Props are plain data, and React context doesn't cross into the island.
- Each island costs a host→remote server hop. Use caching, `preloadIsland` and region co-location. Islands can't be
  nested.
- Each distinct island remote on a page costs about 76 KB gzip of JavaScript (React, React DOM, the RSC client, island code); islands from one remote share it, and remotes on the same exact React version share React itself (when the sharing gate passed).
- The host trusts remote HTML and scripts, so remotes come from an allowlist of origins.
- Remote assets need CORS headers.
- No CSS isolation (no Shadow DOM). Remotes scope their own styles.
- Island metadata never reaches the host `<head>`.
- Island HTML is carried about 3× in a host page (DOM plus the framework's embedded data). Keep islands small.
- No Fast Refresh for island code while it runs inside a host (F5).
- A remote must run its server in the same React mode as its client bundle (F9).

### Choosing a mode (docs guidance)
| Need | Mode |
|---|---|
| Interactive widget sharing context/state with the host | A |
| Server-rendered, data-heavy section owned by another team, with server data and secrets | B |
| Pages Router host that wants a remote's Server Components | B |

## 7. React sharing (Mode A, browser)

This section is about the host's Mode A scope. Islands share in their own scope, `nf-islands` (§6 Shared React); the two scopes never mix.

Mode A remotes use **the host's browser React instance**, without naming Next's internal React paths.

- The adapter's own client module imports `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime` and (in dev)
  `react/jsx-dev-runtime`. The host bundler compiles it in the browser layer, so it gets exactly the React that layer
  uses. It provides these to the MF runtime instance as shared singletons. Remotes declare them as shared singletons
  with `import: false`, so remote bundles contain no React.
- **The adapter must stay bundled by the host.** If it gets externalized, it would receive a different React. A runtime
  guard compares the React instance the adapter received with the one rendering it, and throws a clear error
  ("next-federation must not be listed in serverExternalPackages / externals").
- **Version policy (fixed now):** Next ships a React canary, so `strictVersion` is off. Remotes declare
  `requiredVersion: ^19.0.0`. On a major mismatch the runtime refuses to load the remote and shows the fallback with a
  clear error.

Confirmed by the spike: omitting `react-dom/client` from the shared set makes the remote load its own copy and React refuses the mixed versions. Mode A remotes must publish an **absolute** `publicPath` in their manifest (the MF Vite dev manifest's `/` resolves against the host). Exposed modules are excluded from Vite Fast Refresh.

## 8. Public API sketch (illustrative; final names are the builder's call)

```ts
// federation.config.ts (host)
import { defineFederation } from '@next-federation/core'
export const federation = defineFederation({
  remotes: {
    shop:    { origin: 'https://shop.example.com' },
    catalog: { origin: 'https://catalog.example.net' },     // any origin
  },
  islands: { revalidate: 60 },                               // default for public islands
  identity: { issuer: 'https://www.example.com', signingKeys: process.env.NF_SIGNING_KEY! },
})
```

```tsx
// Mode A (browser-rendered in v1.0): App Router 'use client' file, or Pages Router
import { RemoteComponent } from '@next-federation/next'
<RemoteComponent remote="shop" module="./CartButton" props={{ onOpen }} fallback={<CartSkeleton />} />
```

```ts
// next.config.ts
import { withNextFederation } from '@next-federation/next/config'
export default withNextFederation({ cacheComponents: true })
```

```ts
// lib/federation.ts (host, server-only)
import { defineFederation } from '@next-federation/core'
import { createIslands } from '@next-federation/next/server'
import { createFederationRoutes } from '@next-federation/next/routes'

export const federation = defineFederation({
  remotes: {
    shop: { origin: 'https://shop.example.com' },
    catalog: { origin: 'https://catalog.example.net', assetOrigins: ['https://cdn.example.net'] },
  },
  islands: { revalidate: 60 },
  identity: { issuer: 'https://www.example.com', signingKeys: process.env.NF_SIGNING_KEY! },
})
const getIdentity = async ({ cookies }) => { /* return { sub, claims? } or null */ }
export const { RemoteIsland, preloadIsland, revalidateIsland } = createIslands(federation, { getIdentity })
export const routes = createFederationRoutes(federation, { getIdentity })
```

```ts
// app/api/next-federation/[...nf]/route.ts
import { routes } from '@/lib/federation'
export const { GET, POST } = routes
```

```ts
// Remote: vite.config.ts
import { nextFederationIslands } from '@next-federation/vite'
export default {
  plugins: nextFederationIslands({
    name: 'shop',
    base: 'https://shop.example.com/',
    hosts: ['https://www.example.com'],
    issuers: { 'https://www.example.com': 'https://www.example.com/api/next-federation/jwks' },
    islands: { ProductPanel: './src/ProductPanel.tsx', MyOrders: { entry: './src/MyOrders.tsx', private: true } },
  }),
}
```

```tsx
// Remote: a real Server Component, built with @next-federation/vite
import { getIdentity, Link } from '@next-federation/island'
export default async function MyOrders() {
  const user = await getIdentity()            // verified token claims
  const orders = await db.orders(user.sub)    // server-only
  return <ul>{orders.map(o => <li key={o.id}><Link href={`/orders/${o.id}`}>{o.title}</Link></li>)}</ul>
}
```

`identity.signingKey` becomes `signingKeys` (one or more private ES256 JWKs; the first signs, all are published, for rotation).

## 9. Errors, security, caching, observability
- Every remote load or island fetch has a timeout, retries (defaults: 3 s total budget per island including retries; one retry, only for network errors and 502/503/504) and a fallback. Failures
  never crash the host page.
- **Security:**
  - origin allowlists in both directions;
  - JSON props only;
  - host cookies never forwarded;
  - identity only via tokens (§9a);
  - `Origin` checks on remote actions;
  - no scripts in island HTML;
  - envelope `bootstrap`/`css` URLs must belong to the configured remote (R);
  - the token endpoint accepts same-origin requests only;
  - user-facing errors carry a numbered code (`NF-###`) and a docs link.
- **Caching:** public islands are cached per §6's table. Any token-bearing request is private: the remote responds
  `private`/`no-store`, nothing goes in a shared cache, and the library cache (if enabled) keys by user subject.
- **Observability:** events for fetch, hydrate, action and error, with timings. Mode A uses MF runtime plugins.

### 9a. Identity: per-user islands across any origin
Remotes may be on any origin, and browsers block (Safari) or partition (Firefox) cross-site cookies. So identity
uses tokens, not cookies.

- **Token:** a short-lived JWT, signed by the host with an **asymmetric key**. Its audience is one remote
  (`aud` = remote id). Claims come from a host callback whose signature is **per host type**:
  - App Router: `getIdentity({ cookies, headers })`, called with `next/headers` values. This makes that island
    dynamic, as §6 notes;
  - Pages Router: `getIdentity(req)`.
- **Server render:** the host sends the token in `Authorization` on the island fetch. **The token is never written
  into HTML, prerendered output or the host's RSC payload.**
- **Browser:** when an island first needs identity (a Server Action or refetch), the mount gets a token from the
  host's **token endpoint** and refreshes it before expiry. This is a route file the user creates, re-exporting
  library handlers (§8). It authenticates with the host's own same-origin session, so no cross-site cookies are
  involved. Browser tokens are kept in memory only, are bound to the signed-in user (the server render passes an opaque per-user key; a different key discards the cached token), and are dropped on a 401 and on sign-out (`clearIslandTokens()`).
- **Verification:** the host publishes JWKS (same route file). The remote is configured with an **explicit issuer → JWKS URL map**; the JWKS location is never derived from the token. `@next-federation/server` verifies signature (ES256 only), `aud`, `iss` and `exp` before running island code, and exposes claims through `getIdentity()` in the remote. If the JWKS cannot be fetched the remote answers 503, not 401.
- **Keys:** rotation via multiple keys by `kid`. The docs cover key setup on Vercel and self-hosted.
- **Anonymous users:** no token, and the island is public.
- `aud` scopes a token to one remote's **server**. It does not isolate remotes from each other in the browser: island scripts run in the host origin, so any island on a page can ask the host's token endpoint for a token for any configured remote. Only allowlist remotes you would trust with that.
- Tokens live 300 s and are refreshed 30 s before expiry; extra claims come from the host's `getIdentity` callback.

## 10. Phases and exit criteria

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Spike (throwaway)** | Study §2a prior art. Prove: **(c)** an island hydrates with its own React in an App Router host and a Pages Router host; **(c2)** two remotes and several islands on one page with no global collisions; **(d)** the island lifecycle rules (§6): survives host re-render, soft navigation, `router.refresh()`, **Activity hide/show with `cacheComponents`**, **dev StrictMode**, and a **container swap** (key change, error-boundary reset, host Suspense client-render), with `root.render` updates and `buildId` re-bootstrap; **(e)** a cross-site Server Action with a bearer token, and `<Form>` blocking submits (including Enter) before hydration; **(e2)** the `<Link>` bridge with `basePath` and i18n in both routers; **(f)** island bundle cost; **(g)** cached responses survive a remote redeploy (Vercel Skew Protection and self-hosted versioned paths); **(h)** measure payload duplication and pick transports; **(i)** public islands keep a static/ISR page static, in both caching models; **(j)** Mode A browser loading with host React sharing under Turbopack and `--webpack` | Each proven or disproven in a minimal repo under Turbopack **and** `--webpack`. **A webpack pass with a Turbopack failure counts as a failure.** If (c), (c2), (d) or (j) fails, **stop and revisit the design with the user**. If (e) fails, Server Actions leave v1.0 with the user's agreement. **Result: GO (2026-11-14). All stop gates passed under both bundlers; see `docs/spike/phase0-results.md`.** |
| **1. Core + protocol** | `core`, `protocol` (published spec), `react` error boundary and fallbacks, `sdk` (logger, error codes); repo restructure (real packages, fixtures under `test/fixtures/`, spike removed and kept as tag `spike-phase-0`) | Unit tests; spec published; lint guardrail in CI |
| **2. Islands** | `vite` island build + dev checks, `server` handler, Next adapter (App + Pages): both caching models, own Suspense, CSS via host, preload, lifecycle, identity + token/JWKS routes, `<Link>` bridge, island React sharing in the `nf-islands` scope, behind a proving gate; `server/node` multi-build server with retention; tokenizer HTML stripping; envelope URL validation; per-mount id prefixes; `withNextFederation` | e2e green in **dev and production, Turbopack and webpack** (F13), plus Firefox and WebKit with the remote on a **different site**; per-user island correct; static page stays static; remote down → fallback |
| **3. Island Server Actions** | per-island `callServer`, bearer token, CORS + max-age, `<Form>`, dev check for actions imported by client modules (F2); action endpoint hardening (R) | e2e: cross-site action updates the right user's island; token refresh transparent; Enter-key submit before hydration pressed and blocked (G) |
| **4. Mode A (browser)** | `RemoteComponent`, shared React with guard, version policy, `vite` exposes | e2e: context shared; externalization guard fires; React **context** shared with the host (G); absolute manifest `publicPath` (F3) |
| **5. DX + v1.0** | Types (reuse MF `dts-plugin` where suitable), docs site, examples, support matrix, semver, Vercel Skew Protection and Deployment Protection verified **if a Vercel account is available** (G; optional, otherwise documented as unverified); fetched payload transport decided (F12); plugin-rsc `loadCss` bug reported upstream (F8) | v1.0 published |
| **After v1.0** | React Router adapter (first); Mode A SSR (with integrity + memory policy); mixed-router hosts; host import loader; plain-anchor interception; streaming inside islands; React dedup across remotes, only if the Phase 2 sharing gate (plan Task 18A) failed; Rspack RSC remotes | Scoped when started |
| **Watch (not relied on)** | Official Next support for federated RSC or server-side MF | Informational |

## 11. Testing
- **Matrix:** Next latest 16.x and canary × Turbopack and `--webpack` × **`next dev` and `next build && next start`** × App Router and Pages Router × with and without `cacheComponents`, × with `basePath`/i18n. Plus a plugin-rsc next-release job. Remotes run as dev servers in the dev cells and as production builds behind `nf-serve` in the production cells (F13). Chromium everywhere; Firefox and WebKit on the production Turbopack cell. Published packages are smoke-tested on Node 20.9.
- **Fixtures:**
  - host apps for each configuration;
  - a Vite island remote on a **different site** (server-only data, a `'use client'` child, a Server Action, a
    private island);
  - a Mode A remote;
  - a Next app with an adjacent island build.
- **Deploy targets in CI:** a self-hosted Node run; a Vercel deployment is an optional, manually triggered job gated on an account, with remotes on production-style domains.
- **e2e (Playwright) checks:**
  - SSR markup and no hydration warnings;
  - island survival across navigation, refresh, Activity and StrictMode;
  - container swap recovery;
  - Server Actions and pre-hydration submit blocking;
  - remote down and slow;
  - protocol mismatch;
  - static page stays static (assert on build output);
  - no token in HTML or the RSC payload;
  - island React sharing (one React download for two same-version remotes; separate copies on mismatch; host-provided React); two identical islands on one page; envelope with a foreign bootstrap URL; retired build (410) and failed bootstrap leave an inert island; props over the GET limit through a real host; two builds of one remote live on one page.
- **Unit tests:** core, protocol, token verification.
- **Guardrail:** CI fails on imports of `next/dist/**`, on references to `__next_*`, `__RSC_MANIFEST` or `__next_f`,
  and on any `connection(` call in adapters.

## 12. Decisions by the user
- Fresh API; TypeScript, not Rust; App Router and Pages Router; framework-agnostic and resilient to RSC changes.
- Real Server Components in remotes in v1, delivered as **islands**.
- Open source; Vercel and self-hosted; repo private until the spike works.
- No dependence on Next/Vercel upstream changes.
- Next apps don't expose `app/`; they use a separate island build.
- Islands render per-user content on the server; remotes on any origin; island links navigate the host smoothly.
- **After review:** accept v1 cuts (Mode A browser-only; no mixed-router hosts, host loader, or plain-anchor
  interception; forms disabled until hydrated). **React Router ships right after v1.0.**
- **2026-11-15:** `withNextFederation()` is a required config wrapper. Island remotes share React in their own MF scope (`nf-islands`), exact-version, with own-copy fallback, behind a proving gate. Licence MIT. Node floor 20.9 for published packages. Error docs links point at the GitHub repository until a docs site exists. Vercel verification is optional, gated on an account.
- Never mention Claude/Anthropic in commits, PRs or repo descriptions.

## 13. Calls made by the designer (please check)
- Two modes; islands bring their own React; islands built with Vite + plugin-rsc (pinned, contained).
- The remote does the SSR for islands; v1 buffers each island response.
- Island handler deploys as its own service (no mounting inside Next in v1.0).
- GET protocol with a POST fallback; `buildId`; build-pinned absolute URLs; Vercel production domain + Skew Protection.
- Island caching follows the host caching model; no `connection()`; explicit `dynamic: true` with dev warning; tags
  plus `revalidateIsland`.
- Island lifecycle rules (WeakMap-keyed root, no unmount on cleanup, swap detection, re-bootstrap on `buildId` change).
- Every island in its own Suspense boundary; CSS through host React with `precedence`; no hoistables or scripts in
  islands.
- Per-remote bootstrap with no plugin-rsc globals and one per-build registry global; per-island `callServer`.
- Tokens: asymmetric JWT, per-remote `aud`; per-host `getIdentity` signature; never in HTML or RSC payload; user-created
  route file for token and JWKS.
- Bridge strips `basePath` before `push`.
- Mode A version policy: `requiredVersion ^19.0.0`, `strictVersion` off; externalization guard.
- `withNextFederation` config wrapper; factory API; host context in the request; per-mount id prefix; tokenizer stripping; explicit issuer map; build retention policy (3 builds / 24 h).

## 14. Left to the builder
- Decided: package layout (`@next-federation/{sdk,protocol,core,react,server,island,vite,next}`), tooling (pnpm, tsdown, rstest, Playwright, changesets), API names (§8), protocol encoding (`docs/protocol/v1.md`), retry/timeout defaults, token lifetime, embedded transport for v1.
- Decided by the user 2026-11-15: licence **MIT**; error docs links are GitHub blob links on the repository until a docs site exists; Node floor 20.9.
- Still open (user): npm publish timing; a Vercel account for the optional verification.
