# Design: an open-source, framework-agnostic federation library (Next.js first)

Date: 2026-11-13 · Status: draft for review · Name: **`next-federation`**

## 1. Intent

`@module-federation/nextjs-mf` is in maintenance mode and will leave CI around the end of 2026
(module-federation/core#3153). It never supported the App Router: it throws on any `app/`
directory (`module-federation/packages/nextjs-mf/src/plugins/NextFederationPlugin/index.ts:143-149`).
Teams on Next.js 16 have no supported, production-ready way to compose UI from separately deployed
apps at runtime. The closest prior art (§2a) is either work in progress built on Next internals, or
client-only.

We are building an **open-source** replacement with a **fresh API**. It must:

- work in Next.js 16 with **both App Router and Pages Router**;
- let remotes ship **real React Server Components in v1**;
- be **framework-agnostic at its core**, with **React Router** as the second adapter;
- **survive future Next.js and React Server Components changes** without a rewrite;
- deploy on **Vercel and self-hosted Node alike**.

### Why nextjs-mf died (the lesson this design is built around)

It depended on at least 12 Next.js private internals: compiler names, the `.next` output layout,
the shape of Next's externals function, loader names, `require.cache` flushing, and more.
Each Next release cost its maintainers roughly 6 weeks of fixes (per #3153). **Our core rule:
the library must never depend on a Next.js private internal.** Where framework knowledge is
unavoidable, it lives in a small, replaceable adapter that uses only public APIs.

## 2. Verified background (checked 2026-11-13)

| Fact | Source |
|---|---|
| Turbopack is the default bundler for `next dev` and `next build` in Next 16 | `nextjs/packages/next/src/lib/bundler.ts:106-110` |
| Turbopack has no JS plugin API; it accepts webpack-style loaders via `turbopack.rules` | `nextjs/packages/next/src/server/config-shared.ts:150-307` |
| A `webpack()` config without a `turbopack` config exits with an error when Turbopack was picked *by default* (`TURBOPACK === 'auto'`); passing `--turbopack` or setting `turbopack: {}` avoids it | `nextjs/packages/next/src/lib/turbopack-warning.ts:146-165` |
| Next's App Router uses its own vendored React, currently `19.3.0-canary-df6aa4ec-20261112`; latest stable React on npm is `19.3.1` | `nextjs/package.json` (`react-builtin`); `npm view react` |
| An app can run up to 4 React copies: vendored RSC, vendored SSR, compiled browser, and `node_modules` React for Pages Router on the server | `nextjs/packages/next/src/build/create-compiler-aliases.ts:394-530`, `handle-externals.ts` |
| App Router Route Handlers are compiled with the `react-server` condition (`react-dom/server` throws there); Pages Router API routes are not | `nextjs/crates/next-core/src/next_server/context.rs:112-121`, `nextjs/packages/next/src/compiled/react-dom/server.react-server.js` |
| Native Module Federation for Turbopack is in progress (PRs #97625, #97630, #99134, #99144 by sokra), **all open/unmerged**. Browser only; importing a remote from server code is a deliberate error | GitHub, checked 2026-11-13 |
| The MF 2.0 runtime is bundler-agnostic, v2.9.3, and exports `createInstance`, `loadRemote`, `registerRemotes`, `registerShared`, `preloadRemote`, `registerPlugins` | `module-federation/packages/runtime/src/index.ts` |
| `@module-federation/node`'s runtime plugin depends on `__webpack_require__` internals, so it works only in webpack/Rspack-built hosts. The MF SDK has a bundler-free Node loader (`fetch` + `vm.Script`; `vm.SourceTextModule` for ESM) | `module-federation/packages/node/src/runtimePlugin.ts:39-40,148-149`; `module-federation/packages/sdk/src/node.ts:106,426` |
| `@vitejs/plugin-rsc` (Vite's RSC plugin, v0.5.39, **still 0.x**) exists. React Router (v8.5.1) uses it for RSC mode (`@react-router/dev` lists `@vitejs/plugin-rsc ~0.5.26` as an *optional* peer dependency) and ships `react-server` entry points | `npm view` |
| plugin-rsc's **browser runtime keeps state in page-wide globals**: `globalThis.__vite_rsc_client_require__` (client-reference loading) and `globalThis.__viteRscCallServer` (Server Actions). Two copies on one page overwrite each other | `@vitejs/plugin-rsc@0.5.39` `dist/shared-*.js`, `dist/react/browser.js` |
| plugin-rsc builds asset URLs as `config.base + url` and rejects a relative `base` for RSC | `@vitejs/plugin-rsc@0.5.39` `dist/plugin-*.js` (`renderBuiltUrl` assert) |
| `@module-federation/vite` v1.24.0 emits an **ESM** SSR entry. Its default `ssrEntryLoader: "temp-file"` loads ESM remotes on stock Node; only the optional `"vm"` strategy needs `--experimental-vm-modules` | `@module-federation/vite@1.24.0` README |
| `@rspack/core` v2.3.2 | `npm view` |
| `next/server` exports `connection()` (public API to opt a render into dynamic rendering) | `nextjs/packages/next/server.d.ts:22` |
| Next treats multipart POSTs to app pages as possible Server Actions and rejects unknown action IDs with 400 | `nextjs/packages/next/src/server/lib/server-action-request-meta.ts:36-47`, `src/server/app-render/action-handler.ts` |
| The MF runtime caches loaded remote entries process-wide (on `globalThis[<entry global name>]` and a global loading map), across `createInstance` instances | `module-federation/packages/runtime-core/src/global.ts:259-271`, `utils/load.ts:284-292` |
| No production-grade federated React Server Components exist. MF team attempts (core PRs #4247, #4467, #3736) were closed unmerged | GitHub |

### 2a. Prior art to study in Phase 0
- **Vercel `remote-components`** (npm v0.4.16, repo `vercel/microfrontends`, peer `next >=15`). Host adapters for
  Next App Router, Pages Router and plain React, plus a remote adapter for Next App Router. Its README calls it
  work in progress, not production-ready. Its build references Next internals (`__RSC_MANIFEST`,
  `__next_require__`) and uses Shadow DOM. **It proves demand and shows what exposing a Next `app/` remote
  costs: dependence on internals.**
- **`@module-federation/vite` `experiments.ssrMode: 'ISLAND'`**: client-component SSR/hydration islands that
  refuse to share `react` (each island brings its own React), the same choice this design makes. These are
  not RSC islands. **Candidate to reuse for island asset loading.**

## 3. Goals, non-goals, anti-goals

### Goals
1. A host on **Next.js 16 (App Router or Pages Router, Turbopack or webpack)** or **React Router 8**
   can render UI from separately deployed remotes.
2. **Real Server Components in remotes (v1):** async server components, server-only code and data,
   `'use client'` boundaries, and Server Actions all run on the remote. The host shows the result as an
   **island** (§6 Mode B).
3. **Remote client components (v1)** that share React context with the host (§6 Mode A).
4. Everything is **server-rendered on first load and hydrated** in the browser. Nothing just pops in on the client.
5. **One mental model and one API** across all supported hosts.
6. **Zero required build step in the host.** Any host build integration is optional convenience.
7. **Survives upgrades:** a new Next minor must not require changes outside the Next adapter, and
   ideally none at all.
8. A remote that is down or slow shows a fallback, never a broken page.
8a. Islands can render **per-user content on the server** for remotes on **any origin** (§9a), and links
    inside islands **navigate the host client-side** (§6 navigation bridge).
9. TypeScript types for remote components and island props.
10. **Open-source quality:** public docs, examples, semver, and a published support matrix.

### Non-goals (v1)
- **In-tree federated Server Components**, meaning remote server components mixed into the host's own RSC
  tree with shared context or children. They require Next private internals. They may come back as an optional
  mode only if Next ships official support (see §10 "Watch").
- Route-level / page-level splitting. Next multi-zones and `@vercel/microfrontends` cover it.
- Next.js before 16, React before 19, and non-React frameworks.
- Edge runtime in the **host** (Node runtime only). Remotes may deploy anywhere that runs a Web `fetch` handler.

### Anti-goals (would be failure even if it "works")
- Importing from `next/dist/...` or touching undocumented Next globals (`__RSC_MANIFEST`,
  `__next_require__`, compiler names, `.next` layout).
- Forcing users onto `--webpack` or `next-rspack`.
- Patching Node's `require.cache` or monkey-patching React.
- Coupling remotes to the host's React version or release channel for islands.
- An API that differs between hosts for the same task.

## 4. Constraints
- **TypeScript everywhere.** The user decided this. Rust (an SWC Wasm plugin) was considered and rejected:
  SWC plugins break across hosts' pinned `swc_core` versions and do nothing in Vite/esbuild/Rolldown.
  The build work is trivially cheap, so Rust gives no benefit.
- **Module Federation 2.0 runtime and `mf-manifest.json`** for Mode A, which keeps us compatible with
  Turbopack's upcoming native support and with Rspack/webpack/Vite remotes.
- **Mode B builds on React's RSC APIs** (`react-server-dom-webpack`, which includes its documented bundler-integration
  contract, the `__webpack_require__` free variable that bundlers rewrite) and on `@vitejs/plugin-rsc` for the
  remote's server/SSR build. plugin-rsc is 0.x, so `next-federation/vite` pins a tested version range, keeps every
  plugin-rsc touchpoint in one module, and CI tests the next plugin-rsc release (like the Next canary job).
  This is a **known, contained dependency**, and is the main maintenance risk of Mode B.
- **Deploys on Vercel and self-hosted Node.** No platform-specific APIs in core. Platform niceties go in
  optional helpers.
- Node ≥ 20.9 (Next 16's floor). Builder's call whether to raise it.

## 5. Architecture

Each layer depends only on the layers below it.

```
┌──────────────────────────────────────────────────────────────────┐
│ Host adapters (small; public framework APIs only)                │
│   next-federation/next          App Router + Pages Router                  │
│   next-federation/react-router  React Router 8                             │
├──────────────────────────────────────────────────────────────────┤
│ Remote tooling                                                   │
│   next-federation/vite      Vite plugin for remotes: island build (wraps   │
│                   @vitejs/plugin-rsc) + Mode A exposes (wraps    │
│                   @module-federation/vite); emits manifests      │
│   next-federation/server    framework-free island handler                  │
│                   (Web Request → Response)                       │
├──────────────────────────────────────────────────────────────────┤
│ Optional host build integration (convenience only)               │
│   next-federation/loader    webpack-style loader: webpack, Rspack, and     │
│                   Turbopack via turbopack.rules                  │
├──────────────────────────────────────────────────────────────────┤
│ Core (framework-free TypeScript)                                 │
│   next-federation/core      remote registry, manifest fetch, MF runtime    │
│                   instances, timeouts, retries, errors, events   │
│   next-federation/react     React bindings: RemoteComponent, Island mount, │
│                   error boundary                                 │
│   next-federation/protocol  island protocol types + versioning             │
└──────────────────────────────────────────────────────────────────┘
```

Package names and layout are the builder's call. The rule: `core`, `react`, `protocol` and `server` import no framework.

## 6. Two federation modes

### Mode A: remote client components (shared context)
The host loads a remote's JavaScript module through the MF runtime and renders it **inside the host's
React tree**.

- **Use for:** interactive widgets that must share context or state with the host (cart button, header,
  user menu). Props can include functions and children.
- **Where it runs:** in the browser, plus server-side rendering of client components (Pages Router SSR,
  App Router client-component SSR, React Router SSR). In App Router it is used from a `'use client'`
  file, so the RSC layer never sees it.
- **React sharing** (§7): the remote uses the host's React instance in each environment.
- **Server-side loading:** bundler-free and **never** `@module-federation/node` (it needs a webpack host, §2).
  Remote SSR builds are ESM (what `@module-federation/vite` emits). There are two candidate loaders, and Phase 0
  picks one:
  - `@module-federation/vite`'s default `"temp-file"` strategy, which needs no Node flags;
  - the MF SDK loader.

  Hard requirements for either choice: **no experimental Node flags**, and every shared React import in the
  remote must resolve to the **adapter-provided instance** (§7). The temp-file strategy rewrites imports to
  packages resolved on disk, which in an App Router SSR layer would be `node_modules` React, not Next's
  vendored copy. So the library must make those imports resolve to small shim modules that re-export the
  adapter-provided instance. Unverified inside a Turbopack-built Next server, so **Phase 0 must prove it**.
- **Both routers in one host:** supported. Pages Router SSR (`node_modules` React) and App Router SSR (vendored
  React) run in one process. The MF runtime caches loaded remote entries **process-wide, across
  instances** (§2), so separate instances alone are not enough. The library loads each remote under a
  **distinct entry global name per React environment** (e.g. `shop__pages`, `shop__app`). Remote code is then
  evaluated once per environment, and a container initialised with one React copy is never reused with
  another. Phase 0 tests this.
- **Remote builds:** produced by `next-federation/vite`, which wraps `@module-federation/vite`. Rspack/webpack remotes
  built with standard MF 2.0 tooling also work if they emit `mf-manifest.json` plus a Node build.

### Mode B: RSC islands (real Server Components in remotes)
The remote renders **real React Server Components in its own process** and returns the result. The host
shows it as a self-contained **island**: a separate React root with **its own React runtime**.

**Remote side**
- Island components are built with `next-federation/vite`, which wraps `@vitejs/plugin-rsc` (React's public RSC APIs).
  They can use async server components, server-only modules and secrets, `'use client'` children, and
  Server Actions (`'use server'`).
- The build output includes a **framework-free fetch handler** (`next-federation/server`, Web `Request` →
  `Response`). It deploys anywhere that runs a fetch handler: a Vercel Function, a Node server, or a React
  Router resource route. **Recommended: deploy it as its own service.** Mounting it inside an existing Next
  app's Pages Router API route is possible but secondary. The handler's built output contains React built for
  the `react-server` condition, so it must be loaded **without re-bundling through Next** (a runtime import of the
  built output). It also needs a small Node `req`/`res` ↔ Web `Request`/`Response` bridge. Phase 2 decides whether
  to support this officially.
- **Next apps do not expose their `app/` components as islands** (user decision, §12). Doing so would need
  Next's internal RSC pipeline, as Vercel's `remote-components` does. A Next team adds a small `next-federation/vite`
  island build next to its app (same repo, separate deploy). The docs must say this plainly and include a
  "sharing components from a Next app" guide.

**Island protocol** (`next-federation/protocol`, versioned; exact wire format fixed in Phase 1 and documented):
- **Request:** `GET` with the island id and JSON-serializable props encoded in the URL, so shared HTTP/CDN caches can
  cache it. When the encoded props exceed a size limit (builder sets it), the request falls back to `POST`, which is
  only cached by the library's own cache. Headers are forwarded only if configured (none by default).
- **Response:** `protocolVersion`; the remote **`buildId`**; server-rendered **HTML**; the **RSC payload**
  for hydration; the island's CSS URLs; its bootstrap module URL; and the remote's React version.
- **Asset URLs are absolute and pinned to the build.** plugin-rsc requires an absolute `base` (§2), so a remote is
  built with its public origin. The recommended origin is **deployment-specific** (e.g. a Vercel deployment URL,
  or a versioned path on self-hosted static hosting). Asset URLs in a cached response then still work after the
  remote redeploys. Self-hosted remotes must keep old builds' assets available for at least the island cache
  lifetime. Docs must cover Vercel preview deployments.
- **Deploy skew:** cache keys include `buildId`. Server Actions post to the build-pinned origin of the build that
  rendered the island, so action IDs always match the code that receives them.
- The remote does the SSR itself (RSC → HTML, done by `@vitejs/plugin-rsc`'s SSR environment), so the host
  never runs the remote's React.
- v1 buffers each island response. The host still streams the page around islands with `<Suspense>`.
  Streaming *inside* an island across the host is a later improvement.
- On an unknown major `protocolVersion`, the host shows the fallback and logs an error.

**Host side**
- **Next App Router:** `<RemoteIsland>` is an async Server Component. It fetches the island during
  render, so it works under `<Suspense>` and streams with the page. It renders a host **client**
  component that mounts the island.
- **Next Pages Router:** a `getServerSideProps` helper fetches the island and passes it as props to the
  mount component.
- **React Router:** a loader helper fetches the island, rendered by the mount component.
- **Next prerendering:** `<RemoteIsland>` renders dynamically by default (via the public `connection()` from
  `next/server`), so a remote's content, or its fallback, never gets frozen into static HTML at `next build`.
  Per-island opt-in to static or revalidated rendering is allowed. Under Cache Components / PPR, islands are
  dynamic holes inside `<Suspense>`. The builder documents the behaviour for static, ISR and PPR pages.
- **Island mount (`next-federation/react`):** on the server it outputs the HTML inside a container. In the browser it
  loads the island's bootstrap module from the remote origin. The module calls `hydrateRoot` on the container
  with the RSC payload, **using the island's own React**. Each island gets a unique `identifierPrefix`,
  used both in the remote's SSR and in `hydrateRoot`, so `useId` values never collide between islands.
- **The host never overwrites a live island.** The mount component sets the container's HTML **only on its first
  render** and freezes it after that. When the host re-renders (soft navigation, `router.refresh()`, a host
  Server Action), the new island result arrives **through the host's own server render**. The mount applies only
  its new RSC payload, via `root.render(...)` on the island root, and never replaces the HTML. The browser does not
  refetch from the remote for host-driven updates, which avoids a double fetch and a second identity.
- **Forms before hydration:** islands hydrate late (after the host, plus a cross-origin module load). A form
  submitted before then would POST to the host page, and a Next host rejects the unknown action ID (§2). So the
  island mount **intercepts submits inside a not-yet-hydrated island**, waits for hydration, then replays the
  submit. Forms working without JavaScript are not in v1.

**Multiple islands and remotes on one page (no shared globals)**
plugin-rsc's own browser runtime keeps client-reference loading and `callServer` in page-wide globals (§2), so two
remotes, or a React Router RSC host plus a remote, would overwrite each other. A single global `callServer` also
can't tell which island root an action response belongs to. So islands **do not use plugin-rsc's browser runtime**.
`next-federation/vite` builds a per-remote island bootstrap that:
- bundles `react-server-dom-webpack/client` with its `__webpack_require__` free variable rewritten to a
  **module-scoped loader for that remote** (the bundler-integration contract, not a page global);
- passes **`callServer` per island root** through `createFromReadableStream`'s options (public React API), so each
  action response re-renders the island it came from.

Phase 0 must prove this with **two remotes and several islands on one page, including a React Router RSC-mode host**.

**Server Actions in islands**
- Each island's `callServer` posts to its **own remote's** build-pinned action endpoint. The remote returns a new
  RSC payload that re-renders that island.
- Remotes may be on **any origin** (user decision, §12), so actions are cross-origin requests **without cookies**.
  Identity travels as a bearer **island identity token** in the `Authorization` header (§9a). Because no cookies are
  sent, CSRF via cookies doesn't apply. The remote still checks `Origin` against its allowlist of host origins.
- CORS: the remote allows only configured host origins (never `*`) and allows the `Authorization` header.

**Navigation bridge (links inside islands navigate the host smoothly)**
- Each island root receives a small **host bridge** from the mount component, at minimum `navigate(href)` and
  `prefetch(href)`. The adapter implements it with each host's **public** router API: `next/navigation`
  (App Router), `next/router` (Pages Router) and `useNavigate` (React Router).
- Remotes use `<Link>` from `next-federation/island`. It renders a normal `<a href>` (so it works before hydration and
  for open-in-new-tab and modifier-clicks), and on a plain click it calls the bridge.
- The mount also intercepts plain `<a>` clicks inside the island whose `href` is relative or on the host's origin,
  so ordinary links work too. Remotes can opt out per link (e.g. `data-next-federation-native`). External links are never
  intercepted.
- `href`s are interpreted relative to the **host**. Remotes receive any host routes they need as props or via
  host config, and never hard-code host paths.
- The same `<Link>` works in Mode A components, where the bridge comes from host context.

**Why islands use their own React** (deliberate, see §2): Next ships a React canary, while remotes will
usually use stable React. The RSC payload format is only safe between matching React versions. Tying
islands to the host's React would break remotes whenever Next bumps its canary, and would make
islands impossible in Pages Router or React Router hosts with different React builds. Islands share no
context with the host anyway, so sharing React buys only bytes.
**Cost:** each island remote ships its own React (roughly a React DOM bundle per remote; measure in
Phase 0). Islands from the **same remote** share one copy. Deduplicating React across *different*
remotes on the same React version via an MF share scope is a later optimisation (§10).

**Honest limits (documented to users)**
- Props are plain data. There are no function props, and host components cannot be passed in as children.
- React context does not cross into the island. Theme, auth and locale go in as props.
- Each island costs a host→remote server round trip, so caching matters (§9).
- Each island remote ships its own React plus its own RSC client runtime, so a page with many distinct remotes
  pays that cost per remote (measured in Phase 0).
- The host trusts the remote's HTML and scripts, so remotes come from a configured **allowlist of origins**.
- Remote assets must be served with CORS headers (bootstrap module and chunks are cross-origin ESM).
- No CSS isolation in v1 (no Shadow DOM). Remotes scope their own styles (e.g. CSS Modules).
- Content-Security-Policy: inline island payloads must accept the host's CSP nonce. The adapter
  passes it through.
- In App Router, the island HTML travels in both the document and the host's own RSC payload. This is
  a known size overhead, to be measured, and the builder may mitigate it.

### Choosing a mode (docs guidance)
| Need | Mode |
|---|---|
| Interactive widget sharing context/state with the host | A: client component |
| Server-rendered, data-heavy section owned by another team, with server-side data and secrets | B: island |
| Pages Router or React Router host that wants a remote's Server Components | B: island |

## 7. React sharing (Mode A only)

The remote must use **the same React instance the host uses in that environment**, without naming
Next's internal React paths.

**Approach (validated in Phase 0):** the adapter's own module imports `react`, `react-dom`,
**`react/jsx-runtime`** and, in development, **`react/jsx-dev-runtime`**, plus any `react-dom/*` subpaths
remotes are allowed to use (the builder fixes the list; `react-dom/client` in the browser). Because the
host's bundler compiles this module **in whatever layer imports it**, it receives exactly the React copy
that layer uses. The adapter provides those instances to its per-environment MF runtime instance as shared
singletons. Remotes declare all of them as shared singletons with `import: false` (host-provided), so Mode A
remote bundles never contain React. Server-side, they reach the remote through the shims described in §6
Mode A.

The builder must handle:
- the version-range policy (`requiredVersion`/`strictVersion`) given that Next uses a React canary. Mode A
  remotes need a compatible React 19 range, and the policy must be documented;
- experimental React in the host needs no special case, because it is whatever `react` resolves to.

## 8. Public API sketch (illustrative; final names are the builder's call)

```ts
// Host config (any framework)
import { defineFederation } from 'next-federation/core'
export const federation = defineFederation({
  remotes: {
    shop:    { origin: 'https://shop.example.com' },     // Mode A manifest + islands
    catalog: { origin: 'https://catalog.example.com' },  // islands
  },
  timeoutMs: 3000,
})
```

```tsx
// Mode A: remote client component (App Router 'use client' file, Pages Router, React Router)
import { RemoteComponent } from 'next-federation/next'
<RemoteComponent remote="shop" module="./CartButton" props={{ onOpen }} fallback={<CartSkeleton />} />
```

```tsx
// Mode B: island in a Next App Router server component
import { RemoteIsland } from 'next-federation/next/server'
<Suspense fallback={<PanelSkeleton />}>
  <RemoteIsland remote="catalog" island="ProductPanel" props={{ sku, locale }} />
</Suspense>
```

```tsx
// Remote side: a real Server Component, built with next-federation/vite
// islands/ProductPanel.tsx
import { getProduct } from '../server/db'        // server-only
import { AddToCart } from './AddToCart'          // 'use client' component
export default async function ProductPanel({ sku }: { sku: string }) {
  const product = await getProduct(sku)
  return <section><h2>{product.name}</h2><AddToCart sku={sku} /></section>
}
```

```ts
// Remote vite.config.ts
import federation from 'next-federation/vite'
export default { plugins: [federation({ name: 'catalog', islands: { ProductPanel: './islands/ProductPanel.tsx' } })] }
```

The optional host loader lets users write `import CartButton from 'shop/CartButton'`, which it rewrites to the
equivalent `RemoteComponent` call. Nothing requires it.

## 9. Errors, security, caching, observability
- Every remote load or island fetch has a timeout, retries (builder decides the policy and defaults) and a
  fallback. A library-owned error boundary contains failures. A remote failure never crashes the host page.
- **Security:** origin allowlist in both directions (hosts list remotes, remotes list hosts); JSON props only;
  **host cookies are never forwarded to remotes**; identity only via island identity tokens (§9a); `Origin`
  checks on remote action endpoints; CSP nonce passthrough.
- **Caching:** island responses carry standard `Cache-Control`, and the host honours it by default. Per-island
  overrides are allowed. **Any island request carrying an identity token is treated as private.** The remote
  must respond `Cache-Control: private` or `no-store`. The host never stores it in a shared cache, and the
  library's own cache (if enabled for it) keys it by user subject. Public islands (no token) remain fully
  cacheable via GET. The design works the same on Vercel and self-hosted Node, using no platform cache APIs in
  core. An optional Vercel helper may come later.

### 9a. Identity: per-user islands across any origin
Islands must render **per-user content on the server** (user decision, §12), and remotes may be on **any origin**.
Host cookies can't be shared with third-party origins, and browsers increasingly block cross-site cookies
(Safari blocks them; Firefox partitions them per top-level site by default, so they aren't shared), so identity uses tokens, not cookies:

- **The host mints an island identity token:** a short-lived signed JWT whose audience is one specific remote
  (`aud` = remote id). Its claims come from a **host-supplied callback** (`getIdentity(request) → claims`), so
  the host decides exactly what each remote may know. Tokens are signed with an **asymmetric key** (the
  builder picks the algorithm), so remotes can verify but never mint tokens.
- **Verification:** the host publishes its public keys at a JWKS URL. `next-federation/server` verifies the signature,
  `aud`, `iss` and expiry before running island code, and exposes the verified claims to Server Components and
  Server Actions (e.g. `getIdentity()` inside the remote).
- **Server render:** the host sends the token in the `Authorization` header on the island fetch.
- **Browser (Server Actions, island refetches):** the mount component holds the island's token and sends it as
  `Authorization: Bearer …` on `callServer`. Before expiry it gets a fresh one from a small **token-refresh
  endpoint** that the host adapter provides (public route APIs: an App Router Route Handler, a Pages Router API
  route, a React Router resource route). This endpoint authenticates with the host's own session cookie
  (same-origin), so no cross-site cookies are involved.
- **Keys:** the host config takes a signing key and supports key rotation (multiple keys in the JWKS by `kid`).
  Docs cover generating keys on Vercel and self-hosted setups.
- **Anonymous users:** with no identity (or a host that doesn't configure `getIdentity`), no token is sent and the
  island is public.
- Token lifetime, refresh timing, and the claims schema beyond `sub`/`aud`/`iss`/`exp` are the builder's call
  (short, minutes, by default).
- **Observability:** events for load/fetch start, success, failure and duration, exposed via MF runtime
  plugins (Mode A) and the core event API (Mode B).

## 10. Phases and exit criteria

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Spike (throwaway)** | First, study `remote-components` and MF Vite `ISLAND` mode (§2a) and note what to reuse. Then prove: **(a)** Mode A server-side loading (temp-file or SDK loader, no Node flags, React shims) in a Turbopack-built Next 16 server, no host compiler plugin; **(b)** §7 React sharing per layer, including a host running **both routers** with per-environment entry names; **(c)** an island hydrates with its own React inside a Next App Router host, a Pages Router host and a React Router host; **(c2)** **two remotes and several islands on one page**, including a React Router RSC-mode host, with no global collisions (per-remote bootstrap, per-island `callServer`); **(d)** the island DOM survives host re-renders and client navigation, with updates applied via `root.render`; **(e)** an island Server Action round-trips to a remote on a **different site** with a bearer identity token (no cookies), including a submit before hydration; **(e2)** an island link navigates a Next App Router, Pages Router and React Router host through the bridge; **(f)** measure island React + RSC runtime bundle cost; **(g)** cached island responses keep working after the remote redeploys | Each item proven or disproven in a minimal repo, under Turbopack **and** `--webpack`. **Passing under webpack but failing under Turbopack counts as failing.** If (a), (b), (c) or (c2) fails, **stop and revisit the design with the user**. If (d) fails, use the fallback of re-mounting the island on navigation and document it. If (e) fails, Server Actions move out of v1 with the user's agreement. |
| **1. Core + protocol** | `core`, `protocol` (wire format spec), `react` error boundary/fallbacks | Unit tests; protocol spec doc published |
| **2. Islands (Mode B)** | `next-federation/vite` island build, `next-federation/server` handler, Next adapter (App + Pages), streaming via `<Suspense>`, caching (public vs private), CSP, **identity tokens + JWKS verification + refresh endpoint (§9a)**, **navigation bridge** | e2e green across the matrix (§11) with the remote on a **different site** than the host; per-user island renders the right user; island link navigates the host without a full reload; remote down shows fallback |
| **3. Island Server Actions** | Per-island `callServer` to the remote with bearer token, CORS, `Origin` checks, pre-hydration submit replay | e2e: cross-site form action updates the island for the correct user; expired token refreshes transparently |
| **4. Mode A: client components** | Browser + SSR in Next (both routers, mixed-router host), `next-federation/vite` exposes | e2e: SSR markup present, no hydration warnings, context shared |
| **5. React Router adapter** | Islands + Mode A in React Router 8 | Same e2e suite passes on a React Router host |
| **6. DX + v1.0 release** | Types for remotes and island props (reuse MF `dts-plugin` where suitable), optional host loader, docs site, examples, support matrix, semver policy | Typed usage works in examples; v1.0 published |
| **Later** | Streaming inside islands; React dedup across remotes via MF share scope; Rspack RSC remotes; optional Vercel helpers | Each scoped when started |
| **Watch (not relied on)** | If Next ever ships official support for federated Server Components or server-side Module Federation, evaluate an optional extra mode. Nothing in v1 or later phases waits on it (§12) | Informational only |

Islands come before Mode A because real Server Components in remotes is the user's hard v1 requirement.

## 11. Testing
- **Matrix:** Next latest stable 16.x and latest canary × Turbopack and `--webpack` × App Router, Pages Router,
  and a mixed-router app; React Router latest 8.x. A plugin-rsc "next version" job runs too. Canary runs catch
  upstream changes before release.
- **Fixtures:** host apps for each host type above; a Vite island remote (with a server-only data call, a
  `'use client'` child and a Server Action); a Mode A remote; a Next app with an adjacent island build.
- **Deploy targets in CI:** at least one self-hosted Node run and one Vercel preview deployment.
- **e2e with Playwright:** SSR markup present; hydration without warnings; interactivity; island survives
  navigation; Server Action round-trip; remote-down fallback; slow-remote timeout; protocol version mismatch
  fallback.
- **Unit tests:** core (registry, manifest parsing, retries) and the protocol encoder/decoder.
- **Guardrail:** CI fails if any package imports `next/dist/**` or references `__next_*` / `__RSC_MANIFEST`.

## 12. Decisions by the user
- Fresh API (not nextjs-mf compatible).
- TypeScript, not Rust.
- Must support App Router and Pages Router, and be framework-agnostic and resilient to RSC changes.
- **Real Server Components in remotes in v1, delivered as islands**; in-tree only if Next supports it officially.
- Open source. Deploy on both Vercel and self-hosted Node. Second adapter: React Router.
- **No dependence on Next.js/Vercel upstream changes.** The library must be fully viable without anything new
  landing in Next (including the open Turbopack Module Federation PRs). Upstream work is at most an optional
  bonus.
- **Next apps do not expose their `app/` directory as remotes.** A Next team that shares components writes a small
  separate `next-federation/vite` island (or Mode A) build. No internals-based "unstable" adapter.
- **Islands render per-user content on the server.**
- **Remotes may be on any origin** (third-party domains included), not just same-site subdomains.
- **Links inside islands navigate the host smoothly** (client-side) in v1.

## 13. Calls made by the designer (please check)
- Two modes: A (client components, shared context) and B (RSC islands).
- **Islands bring their own React** instead of sharing the host's (§6 rationale).
- Island remotes are built with Vite + `@vitejs/plugin-rsc` in v1. Rspack RSC comes later.
- A Next app exposes islands through an adjacent `next-federation/vite` build, not its `app/` directory.
- The remote performs SSR for its islands; the host never runs remote React for islands.
- v1 buffers each island response; the host streams around islands.
- Server Actions in islands are in v1 (Phase 3), subject to the Phase 0 (e) result.
- Mode A server-side: ESM remote SSR builds, loaded by the temp-file or SDK loader (Phase 0 picks), with no Node flags and React shims.
- Mixed-router hosts are supported via a distinct remote entry name per React environment.
- Islands use a per-remote bootstrap (no plugin-rsc browser globals) and a per-island `callServer`.
- Island protocol: GET with encoded props (POST fallback for large props), `buildId`, build-pinned absolute asset URLs.
- `<RemoteIsland>` is dynamic by default in Next (via `connection()`), with per-island opt-in to static rendering.
- Live islands are never overwritten. Host-driven updates arrive through the host render and are applied with `root.render`.
- Submits before hydration are intercepted and replayed. No-JS forms are not in v1.
- plugin-rsc is pinned and contained in one module, with a CI job against its next release.
- Identity via host-minted, per-remote, short-lived asymmetric-signed JWTs + JWKS + a host refresh endpoint. Host cookies are never forwarded.
- Token-bearing island responses are always private (never shared-cached).
- Navigation bridge: `navigate`/`prefetch` via public router APIs, a remote `<Link>`, plus interception of host-relative plain anchors.
- Next 16+, React 19+, React Router 8+, Node runtime only in hosts.
- No CSS isolation in v1.
- Test matrix includes Next canary and a CI guardrail against Next internals.

## 14. Left to the builder
Package names and layout, monorepo tooling, the exact API names in §8, the protocol wire encoding details,
retry/timeout defaults, the React version-range policy for Mode A, caching implementation details, the
measures for App Router island-HTML overhead, the docs site, and the library name (to be confirmed with the user before publishing).
