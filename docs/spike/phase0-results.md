# Phase 0 spike results

## Prior art (read-only study of remote-components@0.4.16 and @module-federation/vite@1.24.0)

- **remote-components** shares the **host's** React (one separate `hydrateRoot` per remote, inside a shadow root) and injects host React into each remote's webpack module table. That is the opposite of our "island brings its own React" model.
- It scopes by **namespace, not isolation**. There is one global `self.__webpack_require__` dispatcher. Client-reference ids are rewritten on the server to `"[bundle] id"` and dispatched by prefix in the browser to `__remote_webpack_require__[bundle]`. Turbopack chunk globals are regex-renamed per remote.
- It depends on Next internals (`__RSC_MANIFEST`, `getWorkStore`, `_next` paths). It **does not** meet our no-internals or no-page-globals rules, so we reuse ideas only.
- **@module-federation/vite ISLAND mode** keeps React private to each remote's ESM graph (dynamic `import("react-dom/client")` inside the remote). On the server it uses classic `renderToString` (not RSC), and it hydrates with `hydrateRoot(el, createElement(Component, props))`. The host wrapper injects the HTML and calls the remote's `hydrate()` in an effect. CSS URLs are resolved from `import.meta.url` and de-duplicated.
- Neither package gives `react-server-dom-webpack/client` a per-remote loader without globals.
- **Reuse for Task 5:**
  1. each island bootstrap is its own ESM graph with its own React (MF ISLAND pattern);
  2. rewrite the flight client's module-loading global to a module-scoped function at build time;
  3. **safety net:** prefix client-reference ids with the remote name on the server and assert the prefix in the loader, so a payload routed to the wrong island fails loudly (remote-components idea);
  4. `callServer` per root via `createFromReadableStream` options.

## Verdict: GO

Every stop gate (c, c2, d, j) passed under **both Turbopack and webpack**, so the design's stop
rule does not trigger. The core idea works: real React Server Components from separately deployed
remotes, shown as islands inside Next.js App Router and Pages Router hosts and a client-side SPA,
with no Next.js internals.

Final regression run (2026-11-14), branch `spike/phase-0`:

| Run | Result |
|---|---|
| Unit tests (rstest) | 28/28 |
| e2e, dev servers, Turbopack | 57/57 |
| e2e, dev servers, webpack | 57/57 |
| e2e, production-built remotes | 57/57 |
| Redeploy (skew) suite | 4/4 |
| Production builds of both Next hosts, both bundlers (gate i) | public-island pages static/ISR |
| Lint, including the `next/dist` import ban | 0 errors |

Hosts and versions: Next.js 16.4.6, React 19.3.1 (islands) and Next's vendored canary (hosts),
Vite 8.3.8, `@vitejs/plugin-rsc` 0.5.39, `@module-federation/vite` 1.24.0,
`@module-federation/runtime` 2.9.3, Node 24.22.3, Chromium (Playwright 1.65.0).

## Gates

| Gate | What it tests | Turbopack | webpack | Evidence |
|---|---|---|---|---|
| **c** | Islands with their own React render on the server and hydrate in App Router, Pages Router and an SPA | PASS | PASS | `app-router`, `pages-router`, `spa` specs |
| **c2** | Two remotes and several islands on one page, no global collisions | PASS | PASS | `/two` in both Next hosts (3 islands, 2 remotes) and the SPA `lifecycle` spec; also two builds of one remote live together (`skew`) |
| **d** | Lifecycle: host re-render, `router.refresh()`, soft navigation, hidden `<Activity>` (`cacheComponents`), container swap, toggling during bootstrap | PASS | PASS | App Router: refresh, soft nav, Activity. SPA only: container swap, rapid toggling, toggling during bootstrap. StrictMode only implicitly (App Router dev default); the SPA and Pages hosts don't enable it |
| **e** | Cross-site Server Action with a bearer token and no cookies; forms locked until hydration | PASS | PASS | `actions`, `app-router`, `pages-router` specs |
| **e2** | Island `<Link>` navigates the host client-side, with `basePath` and i18n | PASS | PASS | `app-router`, `pages-router` (incl. `/base/fr/...`) |
| **f** | Island JS cost | measured | — | ~76 KB gzip (242 KB raw, 3 files) per distinct remote |
| **g** | A cached island survives a remote redeploy | PASS (self-hosted, SPA host) | — | `skew` spec, incl. v1 and v2 islands live on one page. Not tested through a Next host's cache with `revalidateTag` |
| **h** | Island data duplication in host pages | partly measured | — | island HTML appears 3× per page; RSC payload count unreliable |
| **i** | Public islands keep static/ISR pages static | PASS | PASS | `next build` route tables for both hosts, both caching models |
| **j** | Mode A: a remote client component on the host's React | PASS | PASS | `/cart` in both hosts (hook runs, no "Invalid hook call") |

Gate **g** was proven for self-hosted, build-pinned paths only. Vercel Skew Protection and
Deployment Protection are **not yet verified** (needs a Vercel deploy).

## How the core question was answered (Task 5)

plugin-rsc's browser runtime keeps client-reference loading and `callServer` in page-wide
globals. Each remote's flight client is rewritten at build time (and in Vite's dependency
optimizer, for dev) so that `__webpack_require__` and `__vite_rsc_require__` point at
`globalThis.__nf_rsc__[<remote origin>]`. `callServer` is passed per island root through
`createFromReadableStream`. A true module-scoped binding is impossible in dev because the flight
client is pre-bundled outside the app's module graph, so the result is **one global per remote,
keyed by the build's absolute base URL: collision-free across remotes AND across builds of one
remote, but not global-free.** (The first version keyed by origin, which collided when two builds of
one remote shared a page; both reviews caught it.)

## Findings that change the design

1. **"No shared globals" should read "no colliding globals"**, keyed per build (see above).
2. **Island Server Actions must reach client components as props** from the server component.
   A client module importing a `'use server'` module gets plugin-rsc's page-global `callServer`.
   Remote authors need a dev-time check.
3. **Remotes must publish absolute URLs**, for Mode A manifests too: the MF Vite dev manifest
   advertised `publicPath: "/"`, which a host on another origin resolves against itself.
4. **Hosts must share React subpaths** (`react-dom/client`, `react/jsx-runtime`), as design §7
   lists. Without `react-dom/client` the remote loaded its own copy next to Next's canary React
   and React refused the mixed versions.
5. **Exposed modules must be excluded from Vite Fast Refresh**, in island remotes and Mode A
   remotes. Fast Refresh code expects a preamble only Vite-served pages have. Developing islands
   therefore has no Fast Refresh inside a host (a DX gap).
6. **Island HTML must be sanitized**: production SSR emits `<link rel="modulepreload">` and React's
   inline form-replay `<script>`, both banned by design §6.
7. **The island bootstrap must keep its exports** in production builds (Vite drops entry exports
   by default).
8. **plugin-rsc 0.5.39 bug:** in builds, only the first `import.meta.viteRsc.loadCss(id)` call
   in a module is wired; later calls reference undefined variables. Workaround: one
   `loadCss()` per island module. Worth reporting to `vitejs/vite-plugin-react`.
9. **An island server must run in the same React mode as its client bundle.** A development-mode
   server sends debug rows that a production flight client rejects (React error 504). The
   envelope should carry the mode and fail with a clear error.
10. **Self-hosted build pinning needs each old build's *server* running, in its own process**,
    not just its static files: actions post to the build that rendered the island, and
    plugin-rsc's server runtime keeps process-wide state. Vercel deployments already work this way.
11. **CORS must allow `X-NF-Action`.** Vite's dev and preview servers answer preflight requests
    themselves, which hid the bug until a standalone server ran.
12. **Island HTML is repeated about 3× per host page** (DOM plus Next's embedded data). Small
    islands are fine embedded; large ones should use the "fetched" transport.
13. **Testing in dev only hides real bugs**: findings 6–9 and 11 appeared only with production
    builds. The main library's conventions require every e2e suite in dev and production.
14. **Vite's dependency pre-bundle cache ignores plugin changes.** The scoped flight client is
    pre-bundled with its registry key baked in; changing the key left a stale bundle and broke every
    island. The cache folder is now named after a hash of the key.

## Gaps (not proven by this spike)

- Vercel Skew Protection and Deployment Protection.
- Safari and Firefox (only Chromium was tested; cross-site cookie rules differ most there).
- React Router as a host (deferred to after v1.0 by design).
- RSC payload duplication count (the measurement was unreliable).
- The remote-name prefix safety net for client-reference ids (from the prior-art study) was not
  implemented.
- Mixed-router hosts and Mode A server rendering (deferred to after v1.0 by design).
- **Next hosts served as production builds** (`next build && next start`): e2e ran against `next dev`;
  only the build route tables were checked (gate i).
- Mode A React **context** sharing with the host (only a hook running on host React was proven).
- Enter-key submission before hydration was inferred from disabled inputs, not pressed.
- Props through a real host: unicode and the 2048-byte POST switch are unit-tested only.

## Cost

About **76 KB gzipped of JavaScript per distinct island remote** on a page (React, React DOM, the
RSC client and the island code). Several islands from the same remote share one copy.

## Guardrail

`git grep -nE "next/dist|__RSC_MANIFEST|__next_f|connection\(" spike/` finds no library or host
code. The matches are a test that reads `self.__next_f` to prove no token leaks into Next's data,
and two `AGENTS.md` files that `next dev` generates (documentation text). The ESLint
`no-restricted-imports` rule bans `next/dist/*` imports and passes.

## Independent review (Opus 5.5 and Fable 5.2)

Two reviewers on different models read the whole branch independently. Both: **GO justified, no
Critical findings**, but the first version of this document overstated gates c2, d and g. Fixed in
the spike (each with a test): per-build registry key; teardown of detached islands; re-bootstrap
when the bootstrap URL or build changes, hydrating with the original envelope; c2 in both Next
hosts; toggling during bootstrap; failures not cached under `'use cache'`; a distinct failure
fallback and a 3.5 s timeout assertion; the issuer allowlist test; JWKS outage returns 503, not 401.

**Carried into Phase 1 as requirements** (not patched in throwaway code):
- Browser tokens tied to the user session, dropped on 401 and on identity change.
- Hosts check that envelope `bootstrap` and `css` URLs belong to the configured remote.
- `aud` does not isolate remotes from each other in the browser (island scripts run in the host
  origin); document it.
- Strip hoistables and scripts with a tokenizer or at the source; the regex sanitizer is cleanup,
  not a security boundary.
- Actions: a "requires identity" gate, body size limits, 400 (not 500) on malformed input, CORS
  headers on error responses.
- `identifierPrefix` unique per mount, not per props.
- Issuer configuration from host config with an explicit issuer→JWKS map, never from source.
- A retirement policy for old builds kept online for skew.
- Run e2e against Next hosts in production mode too.
