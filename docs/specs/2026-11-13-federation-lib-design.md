# Design: next-federation, framework-agnostic UI federation (Next.js first)

Date: 2026-11-13 · Status: draft for review (rev. 3, after a Next.js-maintainer-style review) · Name: **`next-federation`**

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
| plugin-rsc's browser runtime keeps state in page-wide globals (`globalThis.__vite_rsc_client_require__`, `globalThis.__viteRscCallServer`); two copies on one page collide | `@vitejs/plugin-rsc@0.5.39` `dist/shared-*.js`, `dist/react/browser.js` |
| plugin-rsc builds asset URLs as `config.base + url` and rejects a relative `base` for RSC | `@vitejs/plugin-rsc@0.5.39` `dist/plugin-*.js` |
| `@module-federation/vite` v1.24.0 emits ESM SSR entries and has `experiments.ssrMode: 'ISLAND'` (client-component islands that refuse to share `react`) | `@module-federation/vite@1.24.0` README/types |
| Vercel Deployment Protection (Standard) requires auth on generated deployment URLs, so they can't serve public assets to end users. **Per Vercel docs; re-confirm in Phase 0.** | vercel.com/docs/deployment-protection |
| No production-grade federated React Server Components exist (MF core PRs #4247, #4467, #3736 closed unmerged) | GitHub |

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
5. **One API style** for App Router and Pages Router.
6. **No required host build step.**
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
- Streaming *inside* an island across the host; React dedup across remotes; Rspack RSC remotes.

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

## 4. Constraints
- **TypeScript everywhere** (user decision). Rust was rejected: SWC plugins break across hosts' pinned `swc_core`
  versions and don't run in Vite, esbuild or Rolldown.
- **Mode A** uses the MF 2.0 runtime and `mf-manifest.json`.
- **Mode B** uses React's RSC APIs (`react-server-dom-webpack` and its bundler-integration contract, the
  `__webpack_require__` free variable) plus `@vitejs/plugin-rsc` for the remote's server and SSR build. plugin-rsc
  is 0.x, so `next-federation/vite` pins a tested range, confines all plugin-rsc touchpoints to one module, and CI
  tests plugin-rsc's next release. **This is the main maintenance risk.**
- **Public Next APIs only.** The adapters may use:
  - `fetch` with `next: { revalidate, tags }`;
  - `'use cache'`, `cacheLife`, `cacheTag` and `revalidateTag`;
  - `cookies()` and `headers()`;
  - `next/navigation` and `next/router`;
  - Route Handlers and Pages API routes;
  - `getServerSideProps` and `getStaticProps`.

  The adapters must **not** call `connection()` (§2).
- **Vercel and self-hosted Node**, with no platform APIs in core.
- Node ≥ 20.9.

## 5. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Host adapters (public framework APIs only)                       │
│   next-federation/next          App Router + Pages Router (v1.0) │
│   next-federation/react-router  (after v1.0)                     │
├──────────────────────────────────────────────────────────────────┤
│ Remote tooling                                                   │
│   next-federation/vite     remote build: islands (wraps          │
│                            @vitejs/plugin-rsc) + Mode A exposes  │
│                            (wraps @module-federation/vite)       │
│   next-federation/server   framework-free island handler         │
│                            (Web Request → Response)              │
│   next-federation/island   remote-side helpers: <Link>, <Form>,  │
│                            getIdentity()                         │
├──────────────────────────────────────────────────────────────────┤
│ Core (framework-free TypeScript)                                 │
│   next-federation/core      registry, manifests, MF runtime      │
│                             instance, timeouts, retries, events  │
│   next-federation/react     RemoteComponent, IslandMount, error  │
│                             boundary                             │
│   next-federation/protocol  island protocol types + versioning   │
└──────────────────────────────────────────────────────────────────┘
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
- **Remote builds:** `next-federation/vite` (wraps `@module-federation/vite`). MF 2.0 remotes from Rspack or webpack
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
- Islands are built with `next-federation/vite` (wraps `@vitejs/plugin-rsc`). They can use async components,
  server-only modules and secrets, `'use client'` children, and Server Actions.
- The output is a **framework-free fetch handler** (`next-federation/server`). **Recommended deployment: its own
  service** (Vercel Function, Node server). Mounting it inside an existing Next app is not supported in v1.0:
  its built output contains React built for the `react-server` condition, which must not be re-bundled by Next.
- **Next apps do not expose `app/` components as islands** (user decision). A Next team adds a small
  `next-federation/vite` island build next to its app (same repo, separate deploy). The docs include a "sharing
  components from a Next app" guide.
- **Island rules, enforced by a dev-time check in `next-federation/vite`:**
  - no hoistable elements (`<title>`, `<meta>`, `<link rel="stylesheet" precedence>` etc.), because two React
    copies managing one `<head>` would fight Next's metadata (island metadata never reaches `generateMetadata`);
  - no `<script>` in island HTML;
  - forms must use `next-federation/island`'s `<Form>` (see "Forms before hydration").

#### Island protocol (`next-federation/protocol`, versioned; wire format fixed in Phase 1 and documented)
- **Request:** `GET` with the island id and JSON props encoded in the URL, so it is CDN-cacheable. `POST` is the
  fallback above a size limit (builder sets it), and is cached only by the library's own cache. Optional
  `Authorization: Bearer <identity token>` (§9a). No cookies.
- **Response:**
  - `protocolVersion` and `buildId`;
  - server-rendered **HTML**;
  - the **RSC payload**;
  - CSS URLs;
  - the bootstrap module URL;
  - the remote React version;
  - cache metadata (`Cache-Control`; private if a token was presented).
- **Unknown major `protocolVersion`:** fallback plus a logged error.
- **Payload transport to the browser.** Measure in Phase 0 (h) before fixing it. In App Router the HTML necessarily
  appears in both the document and the host's RSC payload, and passing the RSC payload as a prop adds a third copy.
  Two transports are allowed:
  - **embedded:** the payload goes in the props;
  - **fetched:** the bootstrap fetches the payload from the remote's build-pinned, CDN-cacheable URL.

  The builder picks the defaults per public/private island from the measurements. Pages Router has the same
  concern with `__NEXT_DATA__`.

#### Build pinning and deploy skew
- Asset and action URLs are **absolute and pinned to the build that rendered the island**. plugin-rsc requires an
  absolute `base` (§2).
- **On Vercel:** use the remote's **production domain** plus **Vercel Skew Protection** to pin the deployment. Do not use
  generated deployment URLs, which Deployment Protection puts behind auth (§2). The exact pinning mechanism (the
  deployment id on asset and action requests) is confirmed in Phase 0.
- **Self-hosted:** versioned asset paths, with old builds' assets kept for at least the island cache lifetime.
- Cache keys include `buildId`. When a host re-render delivers an island from a **different `buildId`** than the one
  loaded, the mount **tears the island root down and re-bootstraps it** from the new HTML and bootstrap. This is the
  one case where island HTML is replaced.

#### Host side: Next App Router
- `<RemoteIsland>` is an async Server Component. **It always sits in its own `<Suspense>` boundary**: the component
  adds one itself if the user doesn't. A hydration mismatch elsewhere in the host therefore can't client-render the
  island's DOM away.
- **Caching follows the host's caching model.** The adapter detects it from public config and **never calls
  `connection()`**.

  | | Public island (no identity) | Private island (identity token) |
  |---|---|---|
  | **Without `cacheComponents`** | `fetch(..., { next: { revalidate, tags } })`, so the page stays static/ISR | needs `cookies()`/`headers()`, so the route is dynamic. This is inherent and documented, and a dev warning fires if the page is configured static |
  | **With `cacheComponents`** | rendered inside `'use cache'` with `cacheLife` + `cacheTag` | a dynamic hole under `<Suspense>`. Identity is read *outside* any cache scope; tokens are never minted inside `'use cache'` |

  - Defaults: public islands use `revalidate` from config. `dynamic: true` on a public island is an explicit
    opt-in, with a dev warning when it would make a static route dynamic.
  - Tags are `nf:<remote>` and `nf:<remote>:<island>`. `revalidateIsland(remote, island?)` wraps `revalidateTag`,
    and the docs show a remote-deploy webhook that calls it.
- **CSS:** the host renders the island's CSS URLs as `<link rel="stylesheet" href precedence="next-federation">`
  **through the host's React**. That gives deduplication, no flash of unstyled content on soft navigation, and
  Suspense reveal that waits for styles.
- `preloadIsland(remote, island, props)` starts the island fetch early, e.g. in a layout, to cut server
  waterfalls.

#### Host side: Next Pages Router
- `getIslandProps()` for `getServerSideProps` (dynamic and private islands) and `getStaticProps` (public islands with
  `revalidate`). Its result goes to the same mount component. CSS links are rendered by the host.

#### Island mount (`next-federation/react`): lifecycle rules
1. **Server:** renders a container element with the island HTML (`dangerouslySetInnerHTML`) and a unique
   `identifierPrefix`. The remote uses the same prefix in its SSR, so `useId` values never collide.
2. **Browser, first hydration:** dynamically imports the island's bootstrap from the remote origin, then calls
   `hydrateRoot` on the container with the RSC payload, **using the island's own React**.
3. **The island root is keyed to the container DOM node**, held in a module-level `WeakMap`, **not to the effect**.
   Effect cleanup **never** calls `root.unmount()`. As a result:
   - StrictMode's double effects are harmless;
   - Activity hide/show (Cache Components keeps routes alive in hidden `<Activity>`, §2) preserves the live island.
4. **Teardown** happens only when the container node is gone. This is detected on the next mount pass or by a
   `MutationObserver` on the container's parent.
5. **Container swap:** if the host replaced the container node (remount, key change, error-boundary reset,
   `template.tsx`, a host Suspense client-render), the mount detects the new node and **re-bootstraps** the island
   there.
6. **HTML is written only on first render.** Later host re-renders (soft navigation, `router.refresh()`, host Server
   Actions) deliver the new island result through the host's render. The mount applies **only the new RSC payload**
   via `root.render(...)`. The browser never refetches from the remote for host-driven updates. The exception is a
   `buildId` change (see above).
7. **Errors inside the island root** do not reach host error boundaries, because it is a separate root. The mount
   wires `onUncaughtError`, `onCaughtError` and `onRecoverableError` of `hydrateRoot` into the library's fallback
   and event API. Host StrictMode and the Next dev overlay don't cover island internals, and the docs say so.

#### Multiple islands and remotes on one page (no shared globals)
Islands **do not use plugin-rsc's browser runtime** (page-wide globals, §2). `next-federation/vite` builds a
per-remote bootstrap that:
- bundles `react-server-dom-webpack/client` with `__webpack_require__` rewritten to a **module-scoped loader for that
  remote**;
- passes **`callServer` per island root** via `createFromReadableStream` options, so each action response
  re-renders its own island.

#### Server Actions in islands
- Each island's `callServer` posts to its **own remote's** build-pinned action endpoint, with
  `Authorization: Bearer` (§9a) and no cookies. CORS allows only configured host origins (never `*`), allows
  `Authorization`, and sets `Access-Control-Max-Age` to amortise preflights. The remote checks `Origin` against its
  host allowlist.
- **Forms before hydration:** islands hydrate late, after the host plus a cross-origin module load. A native submit
  would POST to the host page, which Next rejects (400/409, §2). So **island forms are not submittable until the
  island hydrates.** `next-federation/island`'s `<Form>` renders its controls inside a disabled `<fieldset>` on the
  server and enables it after hydration. The dev check flags raw `<form action={serverFn}>` in islands. Phase 0 must
  confirm this blocks implicit (Enter-key) submission too.

#### Navigation bridge
- The mount gives each island root a bridge: `navigate(href)` and `prefetch(href)`, implemented with
  `next/navigation` (App Router) or `next/router` (Pages Router).
- Remotes use `next-federation/island`'s `<Link>`. It renders a real `<a href>` (works before hydration, new tab,
  modifier-clicks) and calls the bridge on plain clicks. **Plain `<a>` interception is deferred.**
- **basePath and locale:** the host passes `basePath` and `locale` to every island, so `<Link>` renders the full
  href. Because both routers' `push` add `basePath` themselves (§2), **the bridge strips `basePath` before calling
  `push`**, to avoid a double prefix. Phase 0 tests this with `basePath` and i18n.

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
- Each island remote ships its own React and RSC client runtime (cost measured in Phase 0).
- The host trusts remote HTML and scripts, so remotes come from an allowlist of origins.
- Remote assets need CORS headers.
- No CSS isolation (no Shadow DOM). Remotes scope their own styles.
- Island metadata never reaches the host `<head>`.

### Choosing a mode (docs guidance)
| Need | Mode |
|---|---|
| Interactive widget sharing context/state with the host | A |
| Server-rendered, data-heavy section owned by another team, with server data and secrets | B |
| Pages Router host that wants a remote's Server Components | B |

## 7. React sharing (Mode A, browser)

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

## 8. Public API sketch (illustrative; final names are the builder's call)

```ts
// federation.config.ts (host)
import { defineFederation } from 'next-federation/core'
export const federation = defineFederation({
  remotes: {
    shop:    { origin: 'https://shop.example.com' },
    catalog: { origin: 'https://catalog.example.net' },     // any origin
  },
  islands: { revalidate: 60 },                               // default for public islands
  identity: { issuer: 'https://www.example.com', signingKey: process.env.NF_SIGNING_KEY! },
})
```

```tsx
// Mode A (browser-rendered in v1.0): App Router 'use client' file, or Pages Router
import { RemoteComponent } from 'next-federation/next'
<RemoteComponent remote="shop" module="./CartButton" props={{ onOpen }} fallback={<CartSkeleton />} />
```

```tsx
// Mode B: App Router server component
import { RemoteIsland } from 'next-federation/next/server'
<RemoteIsland remote="catalog" island="ProductPanel" props={{ sku }} fallback={<PanelSkeleton />} />
<RemoteIsland remote="shop" island="MyOrders" private fallback={<OrdersSkeleton />} />   // identity token
```

```ts
// Host routes the user creates (a library can't inject routes into app/):
// app/api/next-federation/[...nf]/route.ts — token refresh + JWKS
export { GET, POST } from 'next-federation/next/routes'
```

```tsx
// Remote: a real Server Component, built with next-federation/vite
import { getIdentity, Link } from 'next-federation/island'
export default async function MyOrders() {
  const user = await getIdentity()            // verified token claims
  const orders = await db.orders(user.sub)    // server-only
  return <ul>{orders.map(o => <li key={o.id}><Link href={`/orders/${o.id}`}>{o.title}</Link></li>)}</ul>
}
```

## 9. Errors, security, caching, observability
- Every remote load or island fetch has a timeout, retries (builder decides the defaults) and a fallback. Failures
  never crash the host page.
- **Security:**
  - origin allowlists in both directions;
  - JSON props only;
  - host cookies never forwarded;
  - identity only via tokens (§9a);
  - `Origin` checks on remote actions;
  - no scripts in island HTML.
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
  involved.
- **Verification:** the host publishes JWKS (same route file). `next-federation/server` verifies signature, `aud`,
  `iss` and `exp` before running island code, and exposes claims through `getIdentity()` in the remote.
- **Keys:** rotation via multiple keys by `kid`. The docs cover key setup on Vercel and self-hosted.
- **Anonymous users:** no token, and the island is public.
- Lifetime, refresh timing and claims beyond `sub`/`aud`/`iss`/`exp` are the builder's call (minutes by default).

## 10. Phases and exit criteria

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Spike (throwaway)** | Study §2a prior art. Prove: **(c)** an island hydrates with its own React in an App Router host and a Pages Router host; **(c2)** two remotes and several islands on one page with no global collisions; **(d)** the island lifecycle rules (§6): survives host re-render, soft navigation, `router.refresh()`, **Activity hide/show with `cacheComponents`**, **dev StrictMode**, and a **container swap** (key change, error-boundary reset, host Suspense client-render), with `root.render` updates and `buildId` re-bootstrap; **(e)** a cross-site Server Action with a bearer token, and `<Form>` blocking submits (including Enter) before hydration; **(e2)** the `<Link>` bridge with `basePath` and i18n in both routers; **(f)** island bundle cost; **(g)** cached responses survive a remote redeploy (Vercel Skew Protection and self-hosted versioned paths); **(h)** measure payload duplication and pick transports; **(i)** public islands keep a static/ISR page static, in both caching models; **(j)** Mode A browser loading with host React sharing under Turbopack and `--webpack` | Each proven or disproven in a minimal repo under Turbopack **and** `--webpack`. **A webpack pass with a Turbopack failure counts as a failure.** If (c), (c2), (d) or (j) fails, **stop and revisit the design with the user**. If (e) fails, Server Actions leave v1.0 with the user's agreement. |
| **1. Core + protocol** | `core`, `protocol` (published spec), `react` error boundary and fallbacks | Unit tests; spec published |
| **2. Islands** | `vite` island build + dev checks, `server` handler, Next adapter (App + Pages): both caching models, own Suspense, CSS via host, preload, lifecycle, identity + token/JWKS routes, `<Link>` bridge | e2e matrix green with the remote on a **different site**; per-user island correct; static page stays static; remote down → fallback |
| **3. Island Server Actions** | per-island `callServer`, bearer token, CORS + max-age, `<Form>` | e2e: cross-site action updates the right user's island; token refresh transparent |
| **4. Mode A (browser)** | `RemoteComponent`, shared React with guard, version policy, `vite` exposes | e2e: context shared; externalization guard fires |
| **5. DX + v1.0** | Types (reuse MF `dts-plugin` where suitable), docs site, examples, support matrix, semver | v1.0 published |
| **After v1.0** | React Router adapter (first); Mode A SSR (with integrity + memory policy); mixed-router hosts; host import loader; plain-anchor interception; streaming inside islands; React dedup; Rspack RSC remotes | Scoped when started |
| **Watch (not relied on)** | Official Next support for federated RSC or server-side MF | Informational |

## 11. Testing
- **Matrix:** Next latest 16.x and canary × Turbopack and `--webpack` × App Router and Pages Router × with and without
  `cacheComponents`, × with `basePath`/i18n. Plus a plugin-rsc next-release job.
- **Fixtures:**
  - host apps for each configuration;
  - a Vite island remote on a **different site** (server-only data, a `'use client'` child, a Server Action, a
    private island);
  - a Mode A remote;
  - a Next app with an adjacent island build.
- **Deploy targets in CI:** a self-hosted Node run and a Vercel preview, with remotes on production-style domains.
- **e2e (Playwright) checks:**
  - SSR markup and no hydration warnings;
  - island survival across navigation, refresh, Activity and StrictMode;
  - container swap recovery;
  - Server Actions and pre-hydration submit blocking;
  - remote down and slow;
  - protocol mismatch;
  - static page stays static (assert on build output);
  - no token in HTML or the RSC payload.
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
- Per-remote bootstrap with no plugin-rsc globals; per-island `callServer`.
- Tokens: asymmetric JWT, per-remote `aud`; per-host `getIdentity` signature; never in HTML or RSC payload; user-created
  route file for token and JWKS.
- Bridge strips `basePath` before `push`.
- Mode A version policy: `requiredVersion ^19.0.0`, `strictVersion` off; externalization guard.

## 14. Left to the builder
Package layout and names, monorepo tooling, final API names, protocol encoding details, the payload transport defaults
(after Phase 0 measurement), retry/timeout defaults, token lifetime, the docs site, the license (to be confirmed with
the user before going public), and the npm publish timing.
