# Proposed edits to the design after Phase 0

Date: 2026-11-15 · Status: **for approval** — nothing here has been applied to
`2026-11-13-federation-lib-design.md`.

Sources: `docs/spike/phase0-results.md` (14 findings, gaps, independent review) and the decisions
made while planning the real library (`docs/plans/2026-11-15-phase1-library.md`). Each edit names
its source: **F***n* = spike finding, **R** = independent-review requirement, **G** = spike gap,
**P** = planning decision that needs your approval because it changes what the design says.

Edits marked **P** are the ones to read closely; the rest record what the spike already proved.

---

## Header

**Old:** `Status: draft for review (rev. 3, after a Next.js-maintainer-style review)`
**New:** `Status: approved (rev. 4, after the Phase 0 spike and two independent reviews)`

## §2 Verified background

**Edit the plugin-rsc globals row (F1).**
Old: "…two copies on one page collide"
New: "…two copies on one page collide. The flight client is pre-bundled outside the app's module graph in dev, so a true module-scoped binding is impossible; scoping is done with one registry global keyed per build (§6)."

**Edit the Vercel row (G).**
Old: "**Per Vercel docs; re-confirm in Phase 0.**"
New: "**Per Vercel docs; not verified by the spike. Verified in Phase 5 on a real deployment.**"

**Add rows.**

| Fact | Source |
|---|---|
| `'use cache'` only compiles when `cacheComponents` is on, so the caching implementation must be selected at build time | Phase 0 spike (`spike/host-app/next.config.ts`) |
| Production SSR emits `<link rel="modulepreload">` and React's inline form-replay `<script>`; dev does not | F6 |
| plugin-rsc 0.5.39 wires only the first `import.meta.viteRsc.loadCss()` call per module in builds | F8 |
| A development-mode RSC server sends debug rows a production flight client rejects (React error 504) | F9 |
| plugin-rsc's server runtime keeps process-wide state: two builds cannot share one process | F10 |
| Vite's dev and preview servers answer CORS preflights themselves, hiding handler CORS bugs | F11 |
| Vite's dependency pre-bundle cache does not notice plugin changes | F14 |
| Measured: ~76 KB gzip of JS per distinct island remote; island HTML appears ~3× in a host page | Gates f, h |

## §3 Goals, non-goals, anti-goals

**Goal 6 (accepted by the user 2026-11-15).**
Old: "**No required host build step.**"
New: "**No host bundler plugin, loader or extra build step. One required config wrapper:** a Next host wraps its `next.config` with `withNextFederation()`. The wrapper uses public config keys only (`env`, `turbopack.resolveAlias`, `webpack` alias, `transpilePackages`) to select the island caching implementation that matches `cacheComponents` and to expose `basePath`. The adapter fails with a clear error (`NF-017`) if the wrapper is missing."
Why: `'use cache'` cannot be compiled without `cacheComponents`, and no public runtime API reveals the flag. The alternative (two import paths the user picks by hand) cannot detect a wrong pick and would silently turn a static page into a dynamic hole — an anti-goal.

**Deferred list — remove "React dedup across remotes" (user decision 2026-11-15)** and add to Goals (v1.0), after goal 4:
"4a. **Island remotes on the same exact React version share one copy of React** on a page (shared scope `nf-islands`), falling back to their own copy on any mismatch. Conditional on the Phase 2 proving gate; if the gate fails, islands ship without sharing and this returns to the deferred list."

**Deferred list — add:**
- "The **fetched** payload transport (decided in Phase 5 from measurements; v1 of the protocol embeds the payload)."
- "Dev warnings that need to know whether a route is static (not detectable with public APIs)."
- "Fast Refresh for island and Mode A modules while they run inside a host."

**Anti-goals — add:**
- "Deriving a JWKS URL, or any URL, from the content of an unverified token."
- "Importing an envelope's `bootstrap` or `css` URL that is outside the configured remote's origins."

## §4 Constraints

**plugin-rsc bullet.**
Old: "`next-federation/vite` pins a tested range, confines all plugin-rsc touchpoints to one module…"
New: "`@next-federation/vite` pins `@vitejs/plugin-rsc` to an exact version (0.5.39), refuses any other (`NF-025`), and confines all plugin-rsc touchpoints to one directory (`packages/vite/src/plugin-rsc/`), enforced by lint. The island protocol itself is bundler-neutral — HTML, RSC payload, a bootstrap module URL and a `buildId` — so a remote can later be built with Rspack; the Vite tooling is one implementation."

**Public Next APIs list — add:** "`unstable_rethrow` from `next/navigation` (so the adapter never swallows Next's control-flow errors); `next/head`; `next.config` keys `env`, `turbopack.resolveAlias`, `webpack`, `transpilePackages`."

**Node line (user decision: 20.9 stands).**
Old: "Node ≥ 20.9."
New: "Published packages support and are CI-tested on Node ≥ 20.9. Developing this repository (tooling, fixtures, e2e) requires Node ≥ 24; that is a contributor requirement, not a user one."

**Add line:** "Island React sharing uses the MF 2.0 runtime's share scopes (`@module-federation/runtime`), in the browser only."

## §5 Architecture

**Package names (conventions.md).** Replace `next-federation/<x>` with `@next-federation/<x>` throughout, and add one package to the Core box:

```
│   @next-federation/sdk      logger, numbered error codes (NF-###)   │
```

**Move in the diagram.** `getIdentity()` stays in `@next-federation/island`; `<Form>` is added to it in Phase 3. `@next-federation/island/bootstrap` (the browser bootstrap runtime) is new and bundler-neutral. `@next-federation/server/node` (Node listener and multi-build server `nf-serve`) is new.

**Core row.** Old: "registry, manifests, MF runtime instance, timeouts, retries, events". New: "registry, island fetch (timeouts, retries), identity token minting, events. The MF runtime instance and manifests arrive with Mode A (Phase 4)."

## §6 Mode B

### Remote side — island rules

**Old:** "no hoistable elements … no `<script>` in island HTML … forms must use `<Form>`", "enforced by a dev-time check in `next-federation/vite`".
**New:** "Hoistables and scripts are removed at the source where possible (`rscCssTransform: false`) and otherwise stripped from the island HTML by a **tokenizer** in the remote handler, in dev and production (F6, R). In dev the handler warns (`NF-018`) for anything it strips that is not known framework output. This is cleanup, not a security boundary: hosts accept envelopes only from allowlisted origins. Additional rules: **one stylesheet hook per island module**, injected by the plugin (F8); **island modules are excluded from Fast Refresh**, so `@vitejs/plugin-react` must not be added to an island build (F5); **Server Actions must be passed from the server component to client components as props** — a client module importing a `'use server'` module is flagged at dev time (F2, Phase 3)."

### Island protocol

**Request — add:** "The request also carries the **host context** (`basePath`, `locale`) as a second parameter, so `<Link>` renders full hrefs during remote SSR and the context is part of the cache key. Props are serialised as canonical JSON (sorted keys) so equal props share a cache entry." (P; the spike passed these as user props.)

**Response — replace the field list with:**
- `protocolVersion`, `remote`, `buildId`;
- `mode` (`development` | `production`): the React mode of the server that rendered. The bootstrap refuses an envelope whose mode differs from its own (`NF-006`) (F9);
- server-rendered **HTML**;
- the **RSC payload**;
- CSS URLs and the bootstrap module URL, all **absolute and build-pinned** (F3);
- the remote React version;
- `idPlaceholder`: a token the host replaces with a per-mount `useId` prefix (R);
- cache metadata (`Cache-Control`; private if a token was presented).

**Add after "Unknown major":** "**Hosts validate the envelope's URLs**: `bootstrap` and every `css` URL must be on the remote's configured origin or one of its declared asset origins, else the island shows its fallback (`NF-005`) (R)."

**Payload transport.**
Old: "Measure in Phase 0 (h) before fixing it … Two transports are allowed … The builder picks the defaults…"
New: "Measured: island HTML appears about 3× per host page (DOM plus Next's embedded data); the RSC payload count could not be measured reliably (F12). **Protocol v1 embeds the payload.** Hosts warn in development above 100 KB per envelope (`NF-024`). A fetched transport is an additive protocol change, decided in Phase 5 from a repeat measurement."

**Add a paragraph — bootstrap module contract (P).** "The bootstrap URL points at an ES module exporting `mountIsland(container, options)` returning `{ update, destroy }`. This contract, with the envelope, is the whole protocol; it is published as `docs/protocol/v1.md`. A bootstrap must be safe next to other remotes' and other builds' bootstraps on one page."

### Build pinning and deploy skew

**Self-hosted bullet.**
Old: "versioned asset paths, with old builds' assets kept for at least the island cache lifetime."
New: "versioned paths for assets **and handlers**. Each retained build's **server** keeps running, **in its own process** (F10), because islands post to the build that rendered them and plugin-rsc's server runtime is process-wide. `nf-serve` implements this. **Retention policy:** the current build, the newest 3 builds, and any build younger than 24 h stay live; retired builds answer `410` (`NF-023`) and their islands stay visible but inert. Operators keep builds for at least the longer of the host's island cache lifetime and the longest expected open tab (R)."

**Vercel bullet — append:** "Not verified by the spike; verified in Phase 5 (G)."

**Re-bootstrap bullet — append:** "The same applies when the **bootstrap URL** changes with an unchanged `buildId`. Hydration always uses the envelope the frozen HTML came from, then applies the newest (review fix)."

### Host side: Next App Router

**Caching table intro (P).**
Old: "The adapter detects it from public config and **never calls `connection()`**."
New: "`withNextFederation()` reads `cacheComponents` from the host's config and selects the matching implementation at build time. The adapter **never calls `connection()`**, and fails with `NF-017` if the wrapper is missing."

**Table, "Without cacheComponents / Private" cell.**
Old: "…and a dev warning fires if the page is configured static"
New: "…This is documented. (No dev warning: whether a route is configured static is not visible through public APIs.)"

**Defaults bullet.**
Old: "`dynamic: true` on a public island is an explicit opt-in, with a dev warning when it would make a static route dynamic."
New: "`dynamic: true` on a public island is an explicit opt-in, documented as making the route dynamic (or a dynamic hole with `cacheComponents`)."

**Add bullets.**
- "A failed or timed-out island fetch is **never cached** under `'use cache'` (the cached function throws; the caller turns that into the fallback)."
- "`fallback` is the loading state; `errorFallback` (default: `fallback`) is shown when the remote is down, slow, returns an invalid envelope, or the user is anonymous on a private island."
- "Every `catch` in the adapter rethrows Next's control-flow errors first (`unstable_rethrow`)."
- "`revalidateIsland` expires the tag immediately (`revalidateTag(tag, { expire: 0 })`), for deploy webhooks."

### Host side: Next Pages Router

**Add:** "`getIslandProps(ctx, spec)` returns a JSON-serialisable object (`envelope`, `host`, `token` endpoint info) that is spread into `<RemoteIsland>` from `@next-federation/next/pages`. Private islands require `getServerSideProps`."

### Island mount: lifecycle rules

**Rule 1.**
Old: "…a unique `identifierPrefix`. The remote uses the same prefix in its SSR…"
New: "…The remote renders with a placeholder prefix; the host mount replaces it, in the HTML and the payload, with a prefix derived from the host's own `useId()`. The prefix is therefore **unique per mount, not per props**: two identical islands on one page do not collide (R)."

**Rule 4.**
Old: "This is detected on the next mount pass or by a `MutationObserver` on the container's parent."
New: "This is detected by a deferred check after effect cleanup and by a sweep on every mount pass. (No `MutationObserver`; the spike proved this is sufficient, including toggling during bootstrap.)"

**Rule 7 — append:** "An uncaught error tears the island root down and shows `errorFallback`. A bootstrap that fails to load, a React-mode mismatch or a build mismatch leaves the server HTML in place and marks the island **inert**. Events are also dispatched as a bubbling DOM `CustomEvent('nf:island')` on the container, because functions cannot cross the App Router server/client boundary."

### Multiple islands and remotes on one page

**Heading.** Old: "(no shared globals)". New: "(no colliding globals)" (F1).

**Body.**
Old: "bundles `react-server-dom-webpack/client` with `__webpack_require__` rewritten to a **module-scoped loader for that remote**"
New: "bundles `react-server-dom-webpack/client` with its module-loading globals rewritten, at build time and in Vite's dependency optimizer, to **one registry entry per build**: `globalThis.__nf_rsc__[<the build's absolute base URL>]`. This is collision-free across remotes **and across two builds of one remote** on a page, but it is one page global, not zero. The optimizer cache directory is named after a hash of the key (F14). The bootstrap keeps its exports in production builds (F7). As a safety net the bootstrap refuses an envelope from another remote or build (`NF-010`); the client-reference-id prefix from the prior-art study is not implemented."

**Add a subsection — "Shared React across island remotes" (user decision 2026-11-15).**
"Island remotes share `react` and `react-dom` (with `react-dom/client`, `react/jsx-runtime`, and any libraries a remote declares) through a Module Federation share scope named **`nf-islands`**. It is separate from the host's Mode A scope, because an App Router host runs Next's canary React and must never mix with islands.
- Entries are **singletons with strict, exact-version matching**. The RSC wire format is only guaranteed between identical React versions, and the envelope already carries `reactVersion`.
- **On a mismatch a remote uses its own bundled copy.** It still works; there is just no saving. Sharing never couples a remote to the host's React version or channel (anti-goal unchanged).
- **The RSC flight client (`react-server-dom-webpack/client`) is never shared.** Each build keeps its own copy and its per-build registry slot; it imports `react`/`react-dom` from the shared scope.
- **A host on the same stable React may provide its React** into `nf-islands` (`provideHostReact()`): Pages Router and SPA hosts. App Router hosts never do.
- Production builds only; dev remotes do not share.
- Cost: ~76 KB gzip per distinct remote without sharing (spike). Target with sharing: first remote ≤ 84 KB, each further same-React remote ≤ 30 KB.
- **Conditional on a Phase 2 proving gate** (two same-React remotes → exactly one React download; mismatched versions → both work with separate copies; existing collision and skew tests still pass). If the gate fails, islands ship without sharing, as in the spike, and sharing moves to after v1.0."

**"Multiple islands and remotes" — also edit** "Each island remote ships its own React" wherever it appears to "…ships its own React unless it can share an identical version (see Shared React)". The page then carries one more third-party global, the MF runtime's `__FEDERATION__`.

### Server Actions in islands

**Add (F2, F11, R):**
- "Actions reach client components **as props** from a server component. A client module that imports a `'use server'` module would get plugin-rsc's page-global `callServer`; a dev check flags it."
- "CORS allows `Authorization`, `Content-Type` and `X-NF-Action`, and CORS headers are sent on error responses too."
- "The action endpoint has a per-island 'requires identity' gate, a body size limit, and answers malformed input with 400, not 500."
- "Until Phase 3 ships, an island build that contains `'use server'` fails with `NF-019`."

### Navigation bridge

**basePath and locale bullet (P).**
Old: "the host passes `basePath` and `locale` to every island, so `<Link>` renders the full href."
New: "the host sends `basePath` and `locale` with every island request (protocol host context), so `<Link>` renders the full href on the remote's server. Island authors write host-relative hrefs (`/orders/1`) and never handle the prefix themselves."

**Phase 0 sentence.** Old: "Phase 0 tests this with `basePath` and i18n." New: "Proven in Phase 0 for both routers (gate e2)."

### Honest limits

**Replace** "Each island remote ships its own React and RSC client runtime (cost measured in Phase 0)."
**with** "Each distinct island remote on a page costs about 76 KB gzip of JavaScript (React, React DOM, the RSC client, island code); islands from one remote share it, and remotes on the same exact React version share React itself (when the sharing gate passed)."

**Add:**
- "Island HTML is carried about 3× in a host page (DOM plus the framework's embedded data). Keep islands small."
- "No Fast Refresh for island code while it runs inside a host (F5)."
- "A remote must run its server in the same React mode as its client bundle (F9)."

## §7 React sharing (Mode A)

**Add at the top:** "This section is about the host's Mode A scope. Islands share in their own scope, `nf-islands` (§6 Shared React); the two scopes never mix."

**Add (F3, F4, F5):** "Confirmed by the spike: omitting `react-dom/client` from the shared set makes the remote load its own copy and React refuses the mixed versions. Mode A remotes must publish an **absolute** `publicPath` in their manifest (the MF Vite dev manifest's `/` resolves against the host). Exposed modules are excluded from Vite Fast Refresh."

## §8 Public API sketch (P)

Replace the Mode B and routes examples. Reason: Next compiles server components, route handlers and client code as separate module instances, so a bare `RemoteIsland` import has no reliable way to find the host's configuration; a factory makes the wiring explicit.

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

`identity.signingKey` becomes `signingKeys` (one or more private ES256 JWKs; the first signs, all are published, for rotation).

## §9 Errors, security, caching, observability

**Security list — add:**
- "envelope `bootstrap`/`css` URLs must belong to the configured remote (R);"
- "the token endpoint accepts same-origin requests only;"
- "user-facing errors carry a numbered code (`NF-###`) and a docs link."

**Timeouts line.** Old: "(builder decides the defaults)". New: "(defaults: 3 s total budget per island including retries; one retry, only for network errors and 502/503/504)."

### §9a Identity

**Verification bullet (R).**
Old: "The host publishes JWKS (same route file). `next-federation/server` verifies signature, `aud`, `iss` and `exp`…"
New: "The host publishes JWKS (same route file). The remote is configured with an **explicit issuer → JWKS URL map**; the JWKS location is never derived from the token. `@next-federation/server` verifies signature (ES256 only), `aud`, `iss` and `exp`… If the JWKS cannot be fetched the remote answers 503, not 401."

**Browser bullet — append (R):** "Browser tokens are kept in memory only, are bound to the signed-in user (the server render passes an opaque per-user key; a different key discards the cached token), and are dropped on a 401 and on sign-out (`clearIslandTokens()`)."

**Add bullet (R):** "`aud` scopes a token to one remote's **server**. It does not isolate remotes from each other in the browser: island scripts run in the host origin, so any island on a page can ask the host's token endpoint for a token for any configured remote. Only allowlist remotes you would trust with that."

**Last bullet.** Old: "…are the builder's call (minutes by default)." New: "Tokens live 300 s and are refreshed 30 s before expiry; extra claims come from the host's `getIdentity` callback."

## §10 Phases

**Phase 0 row — exit criteria, append:** "**Result: GO (2026-11-14). All stop gates passed under both bundlers; see `docs/spike/phase0-results.md`.**"

**Phase 1 row.** Scope: add "`sdk` (logger, error codes); repo restructure (real packages, fixtures under `test/fixtures/`, spike removed and kept as tag `spike-phase-0`)". Exit: add "lint guardrail in CI".

**Phase 2 row.** Scope: add "island React sharing in the `nf-islands` scope, behind a proving gate; `server/node` multi-build server with retention; tokenizer HTML stripping; envelope URL validation; per-mount id prefixes; `withNextFederation`". Exit: replace "e2e matrix green" with "e2e green in **dev and production, Turbopack and webpack** (F13), plus Firefox and WebKit".

**Phase 3 row.** Scope: add "dev check for actions imported by client modules (F2); action endpoint hardening (R)". Exit: add "Enter-key submit before hydration pressed and blocked (G)".

**Phase 4 row.** Exit: add "React **context** shared with the host (G); absolute manifest `publicPath` (F3)".

**Phase 5 row.** Scope: add "Vercel Skew Protection and Deployment Protection verified **if a Vercel account is available** (G; optional, otherwise documented as unverified); fetched payload transport decided (F12); plugin-rsc `loadCss` bug reported upstream (F8)".

## §11 Testing

**Matrix line.**
Old: "Next latest 16.x and canary × Turbopack and `--webpack` × …"
New: "Next latest 16.x and canary × Turbopack and `--webpack` × **`next dev` and `next build && next start`** × … Remotes run as dev servers in the dev cells and as production builds behind `nf-serve` in the production cells (F13). Chromium everywhere; Firefox and WebKit on the production Turbopack cell."

**Deploy targets line.** Old: "a self-hosted Node run and a Vercel preview". New: "a self-hosted Node run; a Vercel deployment is an optional, manually triggered job gated on an account."

**Matrix — add:** "Published packages are smoke-tested on Node 20.9."

**e2e checks — add:** "island React sharing (one React download for two same-version remotes; separate copies on mismatch; host-provided React); two identical islands on one page; envelope with a foreign bootstrap URL; retired build (410) and failed bootstrap leave an inert island; props over the GET limit through a real host; two builds of one remote live on one page."

## §12 Decisions by the user

**Add:** "**2026-11-15:** `withNextFederation()` is a required config wrapper. Island remotes share React in their own MF scope (`nf-islands`), exact-version, with own-copy fallback, behind a proving gate. Licence MIT. Node floor 20.9 for published packages. Error docs links point at the GitHub repository until a docs site exists. Vercel verification is optional, gated on an account."

## §13 Calls made by the designer

**Edit:** "Per-remote bootstrap with no plugin-rsc globals" → "Per-remote bootstrap with no plugin-rsc globals and one per-build registry global".

**Add:** "`withNextFederation` config wrapper; factory API; host context in the request; per-mount id prefix; tokenizer stripping; explicit issuer map; build retention policy (3 builds / 24 h)."

## §14 Left to the builder

**Replace with what is now decided and what is still open.**
Decided: package layout (`@next-federation/{sdk,protocol,core,react,server,island,vite,next}`), tooling (pnpm, tsdown, rstest, Playwright, changesets), API names (§8), protocol encoding (`docs/protocol/v1.md`), retry/timeout defaults, token lifetime, embedded transport for v1.
Decided by the user 2026-11-15: licence **MIT**; error docs links are GitHub blob links on the repository until a docs site exists; Node floor 20.9.
Still open (user): npm publish timing; a Vercel account for the optional verification.
