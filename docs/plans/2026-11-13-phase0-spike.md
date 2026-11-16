# Phase 0 Spike + Local Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove or disprove the design's Phase 0 assumptions (c, c2, d, e, e2, f, g, h, i, j) in a local playground with a Next.js App Router host, a Next.js Pages Router host, and a client-side-rendered Vite SPA, and record a go/no-go verdict per gate.

**Architecture:** This is a throwaway prototype in `spike/`, a pnpm workspace inside the `next-federation` repo:
- an island remote (Vite + `@vitejs/plugin-rsc`) that serves the island protocol;
- a prototype host library (`@nf-spike/proto`): island fetch, island mount, identity tokens and the navigation bridge;
- three hosts: Next App Router, Next Pages Router, and a Vite SPA. The SPA is also the Mode A remote.

Playwright tests are the acceptance checks, one spec per gate. The playground apps are kept afterwards as fixtures for later phases; the prototype library code is not.

**Tech Stack:** Node 24, pnpm 10, Next.js 16.4.6 (Turbopack and `--webpack`), React 19, Vite 8, `@vitejs/plugin-rsc`, `@module-federation/vite`, `jose`, Playwright, TypeScript 6.

**Spec:** `docs/specs/2026-11-13-federation-lib-design.md`. Read §6 (Mode B lifecycle rules, protocol, Server Actions, bridge), §7, §9a and the Phase 0 row of §10 before starting.

## Global Constraints

- Runtime: Node **24.22.3** (`nvm use 24`), pnpm **10.28.0** (root `packageManager: "pnpm@10.28.0"`).
- Exact versions: `next@16.4.6`, `vite@8.3.8`, `@vitejs/plugin-rsc@0.5.39` (exact, no caret), `@module-federation/vite@1.24.0`, `react@19.3.1`, `react-dom@19.3.1`, `react-server-dom-webpack@19.3.1` (island remote), `jose@6.2.17`, `@playwright/test@1.65.0`, `typescript@6.0.3` (**not 7.x**, whose compatibility with Next's type-check is unverified).
- **Never** import from `next/dist/**`, reference `__RSC_MANIFEST` / `__next_*` / `__next_f`, or call `connection()`.
- Islands bring **their own React**. Hosts never share React with islands. Mode A shares the host's browser React.
- Island protocol: `protocolVersion: 1`. Response fields are exactly `protocolVersion`, `buildId`, `html`, `rscPayload`, `css`, `bootstrap`, `reactVersion`, `identifierPrefix`.
- Origins. The remotes run on `127.0.0.1` and the hosts on `localhost`, which are **different sites**, so this simulates "any origin":

  | App | URL |
  |---|---|
  | Island remote A | `http://127.0.0.1:4100` |
  | Island remote B | `http://127.0.0.1:4101` (same code, `NF_REMOTE=b`) |
  | Next App Router host | `http://localhost:3100` (`cacheComponents` off) / `http://localhost:3102` (on) |
  | Next Pages Router host | `http://localhost:3101` |
  | Vite SPA (host + Mode A remote) | `http://localhost:4200` |
- Identity tokens: ES256 JWT, `iss: "http://localhost:3100"` (Pages host uses `:3001`), `aud` = remote name, `exp` = 5 minutes. **Never** in HTML or Next's RSC payload.
- Git: work on branch `spike/phase-0`. Commit messages and PR text carry no tool attribution (no `Co-Authored-By` trailer).
- Every gate runs under Turbopack **and** `--webpack`. A webpack pass with a Turbopack failure is a **FAIL**.

## Review Focus

1. **Remote down or slow:** the host page still returns 200 and shows the fallback within the timeout (3000 ms). Test in Task 9 (`remote-down.spec.ts`).
2. **Props with unicode, quotes, `&`, and props over the GET size limit (2048 encoded bytes):** they round-trip exactly, and the large ones switch to POST. Test in Task 2 (`protocol.test.ts`).
3. **Island content containing `</script>` or `<!--`:** this must not break out of the embedded payload or the host document. Test in Task 2 (`protocol.test.ts`) and Task 9 (`injection.spec.ts`).
4. **Expired, invalid or wrong-`aud` token:** the remote returns 401, the private island shows its fallback, and no data leaks. Test in Task 4 (`identity.test.ts`) and Task 9 (`private-island.spec.ts`).
5. **Navigating away and back quickly while an island is still bootstrapping:** no duplicate roots, no console errors, one live island. Test in Task 9 (`lifecycle.spec.ts`, "rapid nav").

---

## File Structure

```
next-federation/
  package.json                 # workspace root scripts (dev:all, build:all, e2e)
  pnpm-workspace.yaml          # spike/*
  spike/
    proto/                     # @nf-spike/proto: prototype host/remote library
      src/protocol.ts          # envelope types, encode/decode props, size limit
      src/identity.ts          # mint/verify ES256 tokens, JWKS
      src/fetch-island.ts      # server-side island fetch with timeout + fallback
      src/island-mount.tsx     # 'use client' IslandMount (lifecycle rules §6)
      src/bridge.ts            # navigation bridge helpers (basePath strip)
      src/remote-handler.ts    # Web Request → Response island handler (used by island-remote)
      test/*.test.ts           # vitest unit tests
    island-remote/             # Vite + plugin-rsc island remote (A and B via NF_REMOTE)
      vite.config.ts
      src/entry.rsc.tsx        # protocol endpoint + action endpoint
      src/entry.ssr.tsx        # RSC → HTML
      src/bootstrap.tsx        # per-remote browser bootstrap: mountIsland()
      src/islands/ProductPanel.tsx, AddToCart.tsx, Counter.tsx, MyOrders.tsx, Banner.tsx, Links.tsx
      src/data.ts              # server-only fake data
    host-app/                  # Next App Router host
    host-pages/                # Next Pages Router host
    spa/                       # Vite React SPA: CSR host + Mode A remote (exposes ./CartButton)
    e2e/                       # Playwright specs, one per gate + review-focus specs
  docs/spike/phase0-results.md # verdict per gate
```

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc` (`24`), `spike/e2e/playwright.config.ts`, `spike/e2e/package.json`
- Modify: `.gitignore` (add `.next/`, `test-results/`, `playwright-report/`, `spike/**/dist/`)

**Interfaces:**
- Produces: root scripts `pnpm dev:all` (runs every app on its port via `concurrently`), `pnpm e2e` (Playwright), `pnpm e2e:webpack` (same with `NF_BUNDLER=webpack`, which makes the Next hosts start with `--webpack`).

- [ ] **Step 1:** `git checkout -b spike/phase-0`
- [ ] **Step 2:** Create the root `package.json` (`private: true`, `packageManager: "pnpm@10.28.0"`, `engines.node: ">=24"`) and `pnpm-workspace.yaml` with `packages: ["spike/*"]`.
- [ ] **Step 3:** Create `spike/e2e/playwright.config.ts`. Set `webServer` entries for every URL in Global Constraints. Each Next host command reads `NF_BUNDLER` (`next dev` for turbopack, `next dev --webpack` for webpack). Use the Chromium project only, `fullyParallel: false`.
- [ ] **Step 4:** Run `pnpm install && pnpm exec playwright install chromium`. Expected: exits 0.
- [ ] **Step 5: Prior-art study (spec §2a).** Unpack `remote-components@0.4.16` and `@module-federation/vite@1.24.0` into a new empty temp dir with `npm pack` and **read only**. In `docs/spike/phase0-results.md` under "Prior art", write ≤ 10 bullets: how each one loads island assets, scopes runtimes, and handles hydration, and what Task 5 should reuse.
- [ ] **Step 6:** Commit: `chore(spike): workspace scaffold and prior-art notes`.

### Task 2: Island protocol

**Files:**
- Create: `spike/proto/package.json` (`@nf-spike/proto`, vitest), `spike/proto/src/protocol.ts`
- Test: `spike/proto/test/protocol.test.ts`

**Interfaces:**
- Produces:
  - `type IslandEnvelope = { protocolVersion: 1; buildId: string; html: string; rscPayload: string; css: string[]; bootstrap: string; reactVersion: string; identifierPrefix: string }`
  - `const GET_PROPS_LIMIT = 2048`
  - `function islandRequest(origin: string, island: string, props: unknown, opts?: { token?: string }): { url: string; init: RequestInit }`: GET with `?p=<base64url(JSON)>` when the encoded length is ≤ the limit, otherwise POST with a JSON body.
  - `function readIslandRequest(req: Request): Promise<{ island: string; props: unknown }>`
  - `function parseEnvelope(json: unknown): IslandEnvelope`: throws `ProtocolError` on a major-version mismatch or a missing field.
  - `function embedPayload(payload: string): string`: JSON-encodes for an inline `<script type="application/json">`, escaping `<`, `>`, `&`, ` ` and ` `.

- [ ] **Step 1: Write failing tests**
  - `islandRequest` uses GET for `{sku:"é\"&<>"}` and POST for a 3000-char prop;
  - a round trip through `readIslandRequest` deep-equals the input in both cases;
  - `parseEnvelope({...valid, protocolVersion: 2})` throws `ProtocolError`;
  - `embedPayload('</script><!--')` contains neither `</script` nor `<!--`, and `JSON.parse` of it returns the original string.
- [ ] **Step 2:** Run `pnpm --filter @nf-spike/proto test`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `protocol.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(spike): island protocol encode/decode`.

### Task 3: Island remote (server side)

**Files:**
- Create: `spike/island-remote/{package.json,vite.config.ts,src/entry.rsc.tsx,src/entry.ssr.tsx,src/data.ts,src/islands/ProductPanel.tsx,src/islands/Counter.tsx,src/islands/AddToCart.tsx,src/islands/Banner.tsx}`, `spike/proto/src/remote-handler.ts`
- Test: `spike/e2e/protocol-endpoint.spec.ts` (Playwright `request` API)

**Interfaces:**
- Consumes: `readIslandRequest`, `IslandEnvelope` (Task 2).
- Produces:
  - `GET|POST {origin}/_nf/island/:id`, which returns an `IslandEnvelope` JSON with `Access-Control-Allow-Origin` echoing only an allowed origin (`localhost:3100/3001/3002/4200`) and `Vary: Origin`;
  - `POST {origin}/_nf/action` (Task 6);
  - islands: `ProductPanel({ sku: string })` (A), `Banner({ text: string })` (B);
  - env vars `NF_REMOTE` (`a`|`b`), `PORT`, `NF_BUILD_ID` (default: the git short sha plus a timestamp).
- `createIslandHandler(opts: { name: string; buildId: string; islands: Record<string, ComponentType<any>>; allowedOrigins: string[]; renderHtml: (rsc: ReadableStream, prefix: string) => Promise<string> }): (req: Request) => Promise<Response>` in `remote-handler.ts`.

- [ ] **Step 1: Write the failing spec.** `GET http://127.0.0.1:4100/_nf/island/ProductPanel?p=<sku "A1">` with `Origin: http://localhost:3100` returns 200. The envelope has `protocolVersion 1`, `html` contains `Product A1` and `data-testid="counter"`, `css.length ≥ 1`, `bootstrap` starts with `http://127.0.0.1:4100/`, and the ACAO header is `http://localhost:3100`. With `Origin: http://evil.test` there is no ACAO header.
- [ ] **Step 2:** Run `pnpm e2e protocol-endpoint`. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - `vite.config.ts`: `rsc()` with `base: \`http://127.0.0.1:${PORT}/\``, and `environments.{rsc,ssr,client}` entries;
  - `entry.rsc.tsx`: route `/_nf/island/:id`. Render the island with `renderToReadableStream` from `@vitejs/plugin-rsc/rsc/server`, `tee()` the stream, read one branch to text for `rscPayload`, and pass the other to `entry.ssr.tsx`'s `renderHtml` via `import.meta.viteRsc.loadModule('ssr','index')`. Collect CSS with `import.meta.viteRsc.loadCss`; render it into the RSC tree and also report it as URLs in `css`.
  - `identifierPrefix` is `nf-${name}-${island}-${hash(props)}-`.
  - `ProductPanel` is an async server component that reads `data.ts` (import `server-only`) and renders `<Counter/>` and `<AddToCart sku/>` (both `'use client'`).
- [ ] **Step 4:** Run the spec. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(spike): island remote serving protocol envelopes`.

### Task 4: Identity tokens

**Files:**
- Create: `spike/proto/src/identity.ts`, `spike/island-remote/src/islands/MyOrders.tsx`
- Test: `spike/proto/test/identity.test.ts`, `spike/e2e/protocol-endpoint.spec.ts` (add cases)

**Interfaces:**
- Produces:
  - `generateHostKeys(): Promise<{ privateJwk: JWK; publicJwks: { keys: JWK[] } }>`
  - `mintIslandToken(opts: { privateJwk: JWK; kid: string; iss: string; aud: string; sub: string; claims?: Record<string, unknown>; ttlSeconds?: number }): Promise<string>`, default ttl 300
  - `verifyIslandToken(token: string, opts: { jwksUrl: string; aud: string; issuers: string[] }): Promise<{ sub: string; [k: string]: unknown }>`, which throws `IdentityError`
  - `getIdentity()` on the remote, readable inside server components (request-scoped via `AsyncLocalStorage`)
- The hosts serve JWKS at `/api/nf/jwks` (Tasks 7/8). Playwright uses a fixture JWKS server on `http://localhost:3999/jwks` for this task.

- [ ] **Step 1: Write failing tests**
  - mint → verify returns `sub`;
  - an expired token (ttl -1) throws `IdentityError`;
  - `aud: "b"` verified against `aud: "a"` throws;
  - a token signed by a different key throws.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement with `jose` (`SignJWT`, `jwtVerify`, `createRemoteJWKSet`, ES256). Remote handler: if `Authorization` is present, verify it. Invalid → `401` with an empty body. Valid → run the island with the identity, and send `Cache-Control: private, no-store`. `MyOrders` renders `Orders for {sub}`, and it requires identity: with none it throws a 401-mapped error.
- [ ] **Step 4:** Run the unit tests and the added endpoint cases (valid token → `Orders for user-1`; bad token → 401; no token on `MyOrders` → 401). Expected: PASS.
- [ ] **Step 5:** Commit: `feat(spike): ES256 island identity tokens`.

### Task 5: Per-remote browser bootstrap + IslandMount (gates c, c2, d)

**Files:**
- Create: `spike/island-remote/src/bootstrap.tsx`, `spike/proto/src/island-mount.tsx`, `spike/proto/src/bridge.ts`
- Test: `spike/e2e/lifecycle.spec.ts` (run against the SPA host first; Tasks 7–8 extend it to the Next hosts)

**Interfaces:**
- Produces:
  - The bootstrap module exports `mountIsland(container: HTMLElement, opts: { envelope: IslandEnvelope; callServer: (id: string, args: unknown[]) => Promise<unknown>; bridge: Bridge; mode: 'hydrate' | 'render' }): IslandHandle`, where `IslandHandle = { update(envelope: IslandEnvelope): void; destroy(): void; buildId: string }`. It uses **the remote's own** `react`/`react-dom/client` and a `react-server-dom-webpack/client` whose `__webpack_require__` resolves through a module-scoped loader. **No** reads or writes of `globalThis.__vite_rsc_*` or `__viteRscCallServer`.
  - `type Bridge = { navigate(href: string): void; prefetch(href: string): void; basePath: string; locale?: string }`
  - `IslandMount` (`'use client'`): props `{ envelope: IslandEnvelope; bridge?: Partial<Bridge>; fallback?: ReactNode; tokenEndpoint?: string }`. It implements spec §6 lifecycle rules 1–7 exactly: WeakMap keyed by container; no unmount in effect cleanup; teardown when disconnected (MutationObserver); re-bootstrap on container swap; HTML written on first render only; later envelopes go to `handle.update`; a different `buildId` triggers destroy and re-bootstrap; `hydrateRoot` error callbacks go to `onIslandError` events.
  - `stripBasePath(href: string, basePath: string): string` in `bridge.ts`

- [ ] **Step 1: Write the failing spec** `lifecycle.spec.ts`, using the SPA page `/islands` (built in Task 6). Assertions:
  - `[data-testid=counter]` increments after a click (hydrated);
  - two remotes on one page (A `ProductPanel` + B `Banner`): both counters work independently, and `window.__viteRscCallServer` is `undefined`;
  - re-render the host with new props: the counter state is preserved and the text updates;
  - force a container swap (a host button toggles `key`): the island works again;
  - a "rapid nav" test toggles island visibility 10 times in 500 ms and ends with exactly one `[data-nf-root]` and no console errors.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Discovering the module-scoped `__webpack_require__` approach **is the spike's core question**. Try options in this order, and record which one worked in the results doc:
  1. a Vite `define`/transform in `island-remote` that rewrites `__webpack_require__` in `react-server-dom-webpack/client` to an import from a per-build virtual module;
  2. plugin-rsc's exported browser API, used with its globals scoped per root (only if it can be done without page globals).

  If neither works, **stop and mark gate c2 FAIL**.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(spike): per-remote island bootstrap and IslandMount lifecycle`.

### Task 6: Vite SPA (CSR host + Mode A remote) and island Server Actions (gates e, j-SPA)

**Files:**
- Create: `spike/spa/{package.json,vite.config.ts,index.html,src/main.tsx,src/routes/Islands.tsx,src/CartButton.tsx}`, `spike/island-remote/src/islands/AddToCart.tsx` (action), `spike/island-remote/src/actions.ts`
- Test: `spike/e2e/actions.spec.ts`, `spike/e2e/spa.spec.ts`

**Interfaces:**
- Consumes: `islandRequest`, `parseEnvelope` (Task 2); `IslandMount` (Task 5); `mintIslandToken` (Task 4).
- Produces:
  - The SPA exposes Mode A module `./CartButton` (`CartButton({ count?: number; onOpen?: () => void })`) via `@module-federation/vite` with `react`, `react-dom` and `react/jsx-runtime` as shared singletons with `import: false` (host-provided). Manifest at `http://localhost:4200/mf-manifest.json`.
  - The SPA route `/islands` fetches envelopes **in the browser** (CORS) and mounts them with `mode: 'render'` (no SSR, since this is a CSR host). It has a `?key-toggle` button for container-swap tests.
  - `POST /_nf/action` on the remote: `{ actionId, args }` with a bearer token. It returns `{ rscPayload }` for the island that called it. `<Form>` renders controls inside `<fieldset disabled>` until hydrated.

- [ ] **Step 1: Write failing specs**
  - `spa.spec.ts`: `/islands` shows `Product A1` and `Banner` text with no SSR (the island is present after load).
  - `actions.spec.ts`:
    - clicking AddToCart in island A updates `[data-testid=cart-count]` **inside island A only**;
    - the request goes to `127.0.0.1:4100/_nf/action` with an `Authorization` header and **no** `Cookie` header;
    - before hydration (block the bootstrap request with `page.route` and delay it 2 s), pressing Enter in the form input and clicking submit trigger no navigation and no POST to the host.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Each island's `callServer` posts to its own remote origin from the envelope's `bootstrap` origin. CORS on `/_nf/action`: allowed origins only, `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Max-Age: 600`.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(spike): SPA host, Mode A remote, cross-site island actions`.

### Task 7: Next App Router host (gates c, d, e2, i, j under Turbopack + webpack)

**Files:**
- Create: `spike/host-app/{package.json,next.config.ts,app/layout.tsx,app/page.tsx,app/orders/page.tsx,app/two/page.tsx,app/nav/[slug]/page.tsx,app/static/page.tsx,app/cart/page.tsx,app/api/nf/[...nf]/route.ts,lib/federation.ts,lib/RemoteIsland.tsx,lib/RemoteComponent.tsx}`
- Test: `spike/e2e/app-router.spec.ts`; extend `lifecycle.spec.ts` with `/two` and `/nav/*`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `RemoteIsland({ remote: 'a'|'b'; island: string; props: object; private?: boolean; fallback: ReactNode })`: an async Server Component that **wraps itself in `<Suspense>`**. Public: `fetch(url, { next: { revalidate: 60, tags: ['nf:'+remote, 'nf:'+remote+':'+island] } })`, or under `cacheComponents` a `'use cache'` function with `cacheLife('minutes')` + `cacheTag(...)`. Private: reads `cookies()` (`nf-user` cookie = sub), mints a token server-side, fetches with `Authorization`, and passes the envelope **without** the token to `IslandMount`. It renders CSS as `<link rel="stylesheet" href precedence="next-federation">`.
  - `app/api/nf/[...nf]/route.ts`: `GET /api/nf/jwks` returns the public JWKS; `POST /api/nf/token?aud=a` returns `{ token }` using the `nf-user` cookie.
  - `RemoteComponent({ remote: 'spa'; module: './CartButton'; props; fallback })` (`'use client'`): browser-only Mode A via `@module-federation/runtime` `createInstance` + `loadRemote`, with host React provided as shared and the runtime `import()` marked `/* webpackIgnore: true */ /* turbopackIgnore: true */`.
  - `next.config.ts`: `cacheComponents: process.env.NF_CC === '1'`, `basePath: process.env.NF_BASE ?? ''`, `i18n` not available in the App Router (locale is tested in the Pages host), `distDir: process.env.NF_CC === '1' ? '.next-cc' : '.next'`.

- [ ] **Step 1: Write the failing spec** `app-router.spec.ts`, run for `:3000` and `:3002` (CC on), under both `NF_BUNDLER` values:
  - `/` server HTML (fetched via `request.get`, no JS) contains `Product A1`; the island is interactive after load; no hydration warnings in the console;
  - `/orders` with cookie `nf-user=user-1` shows `Orders for user-1`, and the page HTML **and** every `self.__next_f` script **do not contain** `eyJ` (JWT prefix);
  - `/nav/one` → island `<Link href="/nav/two">` click → URL changes **without** a document reload (assert via `page.on('framenavigated')` + `performance.getEntriesByType('navigation').length === 1`); with `NF_BASE=/base` the URL is `/base/nav/two` (no `/base/base`);
  - `router.refresh()` button: the island counter state is preserved;
  - CC on (`:3002`): navigate `/nav/one` → `/static` → back. The island is live without re-bootstrapping (counter state kept, `[data-nf-root]` count 1);
  - dev StrictMode: no blank island on first load;
  - `/cart`: Mode A `CartButton` renders the fallback in server HTML and the real button after load, and reads the host `ThemeContext` value `"dark"`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the host.
- [ ] **Step 4: Gate i (static stays static)**
  - Run `NF_BUNDLER=turbopack pnpm --filter host-app build` and `NF_BUNDLER=webpack pnpm --filter host-app build`.
  - Pass condition: the build output lists `/static` as static (`○`) or ISR. `/static` contains only a public island. Repeat with `NF_CC=1`.
  - Record the output lines in the results doc.
- [ ] **Step 5:** Run the spec in all four combinations (turbopack/webpack × CC off/on). Expected: PASS.
- [ ] **Step 6:** Commit: `feat(spike): Next App Router host with islands and Mode A`.

### Task 8: Next Pages Router host (gates c, e2, i, j)

**Files:**
- Create: `spike/host-pages/{package.json,next.config.ts,pages/_app.tsx,pages/index.tsx,pages/orders.tsx,pages/static.tsx,pages/nav/[slug].tsx,pages/cart.tsx,pages/api/nf/[...nf].ts,lib/getIslandProps.ts}`
- Test: `spike/e2e/pages-router.spec.ts`

**Interfaces:**
- Consumes: Tasks 2–7 (the `RemoteComponent` is copied from `host-app/lib`, since this is a spike).
- Produces:
  - `getIslandProps(opts: { remote; island; props; private?: boolean; req?: IncomingMessage }): Promise<{ envelope: IslandEnvelope } | { error: true }>`
  - `next.config.ts`: `i18n: { locales: ['en','fr'], defaultLocale: 'en' }`, `basePath: process.env.NF_BASE ?? ''`

- [ ] **Step 1: Write the failing spec**, mirroring Task 7's spec:
  - SSR HTML contains `Product A1`;
  - `/orders` has no `eyJ` in HTML or `__NEXT_DATA__`;
  - `/fr/nav/one` island link navigates client-side to `/fr/nav/two` (and `/base/fr/nav/two` with `NF_BASE`);
  - `/static` (uses `getStaticProps` with `revalidate: 60`) is listed as ISR in the build output;
  - `/cart` Mode A works.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it under Turbopack and webpack. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(spike): Next Pages Router host`.

### Task 9: Robustness, skew and measurements (gates f, g, h + Review Focus)

**Files:**
- Create: `spike/e2e/remote-down.spec.ts`, `spike/e2e/injection.spec.ts`, `spike/e2e/private-island.spec.ts`, `spike/e2e/skew.spec.ts`, `spike/scripts/measure.ts`
- Modify: `spike/island-remote/vite.config.ts` (versioned asset path `base: http://127.0.0.1:4100/b/<buildId>/`; the server keeps serving every `dist/b/*` it has)

**Interfaces:**
- Consumes: everything above.
- Produces: `pnpm measure`, which prints a JSON report: island bootstrap JS bytes (gzip) per remote, bytes of island HTML, and RSC payload occurrences/bytes in the document, `self.__next_f` and `__NEXT_DATA__` for `/` in both Next hosts. Run it with the embedded transport, then the fetched transport.

- [ ] **Step 1: Write failing specs**
  - `remote-down.spec.ts`: with remote A stopped (`page.route('http://127.0.0.1:4100/**', r => r.abort())` for the browser, plus an env flag that points the host at port 4199 for the server fetch), `/` returns 200 and shows the fallback within 3000 ms. With a remote that delays 10 s (test-only `?delay=10000` prop), the fallback shows and the page completes.
  - `injection.spec.ts`: island prop `text: "</script><script>window.pwned=1</script><!--"` on `Banner` renders as text, and `window.pwned` is undefined, in all three hosts.
  - `private-island.spec.ts`: an expired-token flow (host env `NF_TOKEN_TTL=-1`) shows the fallback, and the HTML contains no `Orders for`.
  - `skew.spec.ts`:
    1. build remote A (`NF_BUILD_ID=v1`) and load `/` (cached envelope);
    2. rebuild with `NF_BUILD_ID=v2` while keeping `dist/b/v1`;
    3. the old page still hydrates and its action works;
    4. after `revalidateTag('nf:a')` (host test route `/api/test/revalidate`), a soft refresh re-bootstraps on v2 (`data-nf-build="v2"`).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the remaining pieces (timeouts in `fetch-island.ts` with `AbortSignal.timeout(3000)`, versioned base, the test routes).
- [ ] **Step 4:** Run the full suite: `pnpm e2e && pnpm e2e:webpack`. Expected: all PASS, or failures recorded against their gate.
- [ ] **Step 5:** Run `pnpm measure` for both transports and save the output to `docs/spike/measurements.json`.
- [ ] **Step 6:** Commit: `test(spike): robustness, skew, and measurements`.

### Task 10: Results and verdict

**Files:**
- Create: `docs/spike/phase0-results.md`

- [ ] **Step 1:** For each gate (c, c2, d, e, e2, f, g, h, i, j), record **PASS/FAIL** under Turbopack and webpack, the evidence (spec name and output lines), and what was learned. Record the chosen `__webpack_require__` scoping approach. Record the payload-transport recommendation from the measurements. Record anything that contradicts the design. **Gate g is proven locally only for self-hosted versioned paths.** Mark the Vercel Skew Protection and Deployment Protection parts "not yet verified (needs a Vercel deploy)".
- [ ] **Step 2:** Apply the design's stop rule. If c, c2, d or j failed (including Turbopack-only failures), mark the verdict **STOP — revisit design with user**. If e failed, note that "Server Actions leave v1.0 pending user agreement".
- [ ] **Step 3:** Run `git grep -nE "next/dist|__RSC_MANIFEST|__next_f|connection\(" spike/ ; echo exit=$?`. Expected: no matches (`exit=1`).
- [ ] **Step 4:** Commit: `docs(spike): phase 0 results`. Push the branch: `git push -u origin spike/phase-0`. Do not open a PR unless the user asks.
