# AGENTS.md

Guidance for agents and contributors working in this repository. `next-federation` is an open-source
runtime UI federation library for Next.js 16. Read `docs/conventions.md` and the design in
`docs/specs/` for background. **Read the package README before editing a package.**

## Repo map

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.mjs  .prettierrc.json
rstest.config.ts  .alexrc  .changeset/config.json  AGENTS.md  README.md
.github/workflows/ci.yml
scripts/
  check-guardrails.mjs          grep guardrail (design §11), with __tests__/check-guardrails.spec.ts
  check-error-docs.mjs          every NF code has docs/errors/<slug>.md
  check-pack.mjs                every package packs its README, LICENSE and CHANGELOG
docs/
  protocol/v1.md                published island protocol spec
  errors/<slug>.md              one page per NF code
  guides/self-hosted-skew.md    build retention policy
packages/
  sdk/        logger.ts, error-codes.ts, nf-error.ts, index.ts
  protocol/   constants.ts, envelope.ts, request.ts, props.ts, id-prefix.ts, bootstrap.ts (types),
              share-scope.ts (island React share scope), secure-url.ts (https rule),
              components.ts (Mode A descriptor, trust registry), semver.ts (shared-module ranges),
              action.ts (Server Action request), index.ts
  core/       config.ts (defineFederation), fetch-island.ts, events.ts, index.ts,
              identity/ (keys.ts, mint.ts, identity-key.ts, index.ts)   → export "./identity",
              components.ts (Mode A descriptor fetch + verify)         → export "./components"
  react/      error-boundary.tsx, island-mount.tsx, island-registry.ts, token-client.ts, events.ts,
              host-react.ts, index.ts; provide-host-react.ts → export "./share";
              components/ (index.tsx, render.tsx, runtime.ts) → export "./components",
              components/server-loader.ts (+ .browser.ts) → export "./components/server-loader"
  server/     strip-html.ts, identity-verify.ts, identity-context.ts, cors.ts, handler.ts,
              action.ts (Server Actions, requireIdentity marker), index.ts,
              node/ (listener.ts, serve-builds.ts, retention.ts, cli.ts) → export "./node", bin "nf-serve",
              node/components-descriptor.ts (Mode A descriptor, shared with the Vite plugin),
              node/describe.ts, node/describe-cli.ts → bin "nf-describe" (any MF 2.0 remote)
  island/     bridge-context.tsx, link.tsx, form.tsx (<Form>), require-identity.client.ts,
              index.client.ts, index.server.ts, bootstrap/ (create-bootstrap.tsx, flight-scope.ts,
              share-scope.ts, call-server.ts (Server Action client), index.ts) → export
              "./bootstrap"; bootstrap/share-scope.ts → export "./share-scope"
  vite/       index.ts, options.ts, scope-flight-client.ts, checks.ts, share.ts (React sharing),
              code-literal.ts, trim-slashes.ts,
              plugin-rsc/ (plugin.ts, entry.rsc.tsx, entry.ssr.tsx, entry.client.tsx,
              bootstrap.client.tsx, css.ts, dev-actions.ts: dev Server Action allowlist),
              components/ (plugin.ts, options.ts, descriptor.ts, shared.ts, version.ts, types.ts:
              the Mode A components remote, nextFederationComponents)
  next/       config.ts → "./config", installed-next.ts (installed Next version and major);
              server/ (create-islands.tsx, island-cache.legacy.ts, island-cache.cc.ts,
              private-envelope.ts, component-descriptor.ts, get-component-descriptor.ts,
              dev-debug-info.ts (NF-037)) → "./server"; client/next-island-mount.tsx;
              routes.ts, route-core.ts → "./routes"; pages/ (create-pages-islands.ts,
              remote-island.tsx, api-handler.ts, component-descriptor.ts) → "./pages",
              "./pages/server"; bridge.ts; types/ (sync.ts, cli.ts) → bin "nf-types"
test/
  fixtures/island-remote/   Vite remote (names a, b), built with @next-federation/vite
  fixtures/host-app/        App Router host (with and without cacheComponents)
  fixtures/host-pages/      Pages Router host (with and without basePath + i18n)
  fixtures/host-spa/        Vite SPA host (StrictMode on) for lifecycle and skew
  fixtures/components-remote/  Mode A Vite components remote (signed, tampered and unsigned builds)
  fixtures/components-context/ the React context hosts share with it
  e2e/                      playwright.config.ts, servers.ts, *.spec.ts, fixtures/jwks-server.ts
examples/                   runnable remotes and hosts (README.md, scripts/run.mjs; `pnpm examples:dev`)
```


## Commands

Workspace tooling needs Node >= 24 and pnpm 10. Published packages target Node >= 20.9.

- `pnpm install`
- `pnpm build`: build every package in `packages/`
- `pnpm test`: rstest unit tests (`packages/*/__tests__`, `scripts/__tests__`)
- `pnpm typecheck`: `tsc -b`
- `pnpm lint`: ESLint (flat config)
- `pnpm lint:docs`: inclusive-language check on docs
- `pnpm guardrail`: grep guardrail (run before building)
- `pnpm check:error-docs`: every error code has a docs page (run after building)
- `pnpm format` / `pnpm format:check`: Prettier
- `pnpm check:pack`: every package's tarball contents (run after building)
- `pnpm e2e`: Playwright suites (`NF_LANE=b` runs on a second port range)
- `pnpm examples:smoke`: start the examples and check every page

## Hard rules

- No Next.js internals: no import of `next/dist/**`; no reference to `__RSC_MANIFEST`, `__next_*`, `__NEXT_*`, `__next_f`, `__next_require__`; never call `connection()`. Enforced by ESLint and `pnpm guardrail` (Task 1); both must pass before every commit.
- Next APIs allowed in `@next-federation/next`, and nowhere else: `fetch` with `next: { revalidate, tags }`; `'use cache'`, `cacheLife`, `cacheTag`, `revalidateTag` (`next/cache`); `cookies()`, `headers()` (`next/headers`); `next/navigation` (incl. `unstable_rethrow`); `next/router`; `next/head`; Route Handlers; Pages API routes; `getServerSideProps`/`getStaticProps`; `next.config` keys `env`, `turbopack.resolveAlias`, `webpack`.
- `sdk`, `protocol`, `core`, `react`, `server`, `island` import no framework (`next`, `vite`, `@vitejs/*`). ESLint enforces it per package.
- All `@vitejs/plugin-rsc*` and `virtual:vite-rsc/*` imports and every `import.meta.viteRsc` use live under `packages/vite/src/plugin-rsc/` only. ESLint enforces it. `@vitejs/plugin-rsc` is pinned to exactly `0.5.39` as a dependency of `@next-federation/vite`.
- The protocol is bundler-neutral. Nothing in `protocol`, `core`, `react`, `server`, `island` may assume Vite. A remote is anything that serves the envelope and a bootstrap ES module honouring `IslandBootstrapModule` (Task 3).
- No dependence on Next/Vercel upstream changes. No `require.cache` patching, no React monkey-patching, no forcing `--webpack`.
- The host never runs island code on its server. The one exception is Mode A (client components) server rendering: the host evaluates a remote's server build only when its descriptor is verified in that process (signed or pinned; `unsafe-dev` only when `NODE_ENV` is development or test) and every fetched file matches its sha384; anything else renders in the browser only. On the server, the server loader evaluates only files of a verified descriptor whose sha384 matches; the host's MF instance refuses its own Node script loader (`createScript`); and a build whose manifest lists `remotes` of its own, or that has no manifest the server loader could check, renders in the browser only on the server. Host cookies are never forwarded to remotes. Identity tokens, host cookies and request headers never appear in HTML, prerendered output, Next's RSC payload, `__NEXT_DATA__`, the dev server's websocket, or any browser storage (tokens: memory only), for the library installed under `node_modules`, in `next dev` as in production with Next's default dev source maps (`test/e2e/installed-dev.spec.ts`). The one exception is library development: under `next dev`, a library linked from outside `node_modules` (workspace link, `npm link`) is app code to Next's dev tooling, so React's debug info carries them to the browser; `getPrivateEnvelope` warns once (`NF-037`), as it also does when `next dev` runs with source maps disabled. Never in a production build.
- Never silently make a static/ISR page dynamic. In `@next-federation/next`, every `catch` around a Next call or a fetch calls `unstable_rethrow(error)` from `next/navigation` first, so Next's control-flow errors are never swallowed.
- Browser globals the library may create: exactly one, `globalThis.__nf_rsc__` (flight-scope registry keyed by a build's absolute base URL). No other `globalThis`/`window` writes in library code. (Finding 1: "no colliding globals".) Permitted third-party globals: the Module Federation runtime's own `__FEDERATION__` (island React sharing, Task 18B, and Mode A), and for Mode A the ones Module Federation and `@module-federation/vite` remote code create (`__mf_module_cache__`, the `__mf_init__*` entries). Server-side `globalThis` slots the library creates, each keyed by a global symbol so duplicate copies of a package share it: `Symbol.for('next-federation.identity')` (`@next-federation/server`, `identity-context.ts`: the `AsyncLocalStorage` that carries a request's verified identity into Server Components and Server Actions); in a remote's Vite dev server only, `Symbol.for('next-federation.dev-server-actions')` (`@next-federation/vite`, `plugin-rsc/dev-actions.ts`: the dev allowlist of `'use server'` files per scope key; production builds never create it); and Mode A's process-wide registry under `Symbol.for('nf.components.verified')` (our `componentTrustRegistry()`, `@next-federation/protocol`), which holds verified descriptor digests (`verified`), each remote's trust policy (`trust`), the count of server runtimes created (`hostRuntimes`, which numbers each runtime's layer), the last `init` per container name (`initLocks`; one running longer than the wait counts as hung and is no longer waited for), and the one layer that server-renders every build the server loader cannot isolate (`unlistedLayer`). On the server the Mode A remote code of each runtime scope sees its own `__mf_module_cache__` and `__mf_init__*` entries (and, for a server entry that bundles its own Module Federation runtime, its own `__FEDERATION__`, `__VMOK__` and `__GLOBAL_LOADING_REMOTE_ENTRY__`), held in the scope, never on the process-wide `globalThis`.
- Exception: `provideFallbackCopies` in `packages/react/src/components/runtime.ts` may set `__mf_module_cache__.share['default:<name>@<version>']` only for a `fallback: true` entry of a verified descriptor, only with a module the host registered whose version satisfies the entry's range, never for `react`, `react/*`, `react-dom`, `react-dom/*`, `next` or `next/*` (`isNeverFallback`, `@next-federation/protocol`), and never over a key that is already set. In the browser it writes `globalThis.__mf_module_cache__`. On the server it writes only the runtime's current scope (`ServerScope.globals`, which the server loader passes to remote code as its `globalThis` for the `@module-federation/vite` keys), never the process-wide global. A runtime has one scope at a time: one runtime per router layer, plus one more per `next dev --webpack` reload. A runtime gets a new scope only when its cache holds a stale fallback copy, at most 4 per runtime (`MAX_SCOPES`); a timed-out load keeps the scope. It is tied to the pinned @module-federation/vite version: re-verify on every bump.
- Island React sharing (user decision 2026-11-15): islands share `react` and `react-dom` in a Module Federation share scope named `nf-islands`, separate from the host's Mode A scope (`default`, shipped in Phase 1), under the library-only key `__FEDERATION__.__SHARE__['@next-federation/island-share@1']`. One instance per **exact version** (MF `singleton: false`, `strictVersion`, `requiredVersion` = the remote's exact React version; Task 18A showed `singleton: true` breaks mixed versions; the RSC wire format is only guaranteed between identical React versions). "One provider" means one per name@key on the page: the key is the exact version for React's own entries, and `<version>+react@<reactVersion>` for any other shared lib, which is bound to the React it imports. Libs of one build may therefore come from different providers (react from one remote, a design-system lib from another on the same React), but each name@key is one object page-wide. A non-production build never shares. On a mismatch a remote uses its own bundled copy — sharing is an optimisation, never a requirement, and never couples a remote to the host's React. `react-server-dom-webpack/client` is **never** shared: each build keeps its own flight client and registry slot. Production builds only; dev remotes never share. App Router hosts never provide React (canary); an SPA or Pages Router host on the identical stable React may opt in with `provideHostReact()` (`@next-federation/react/share`). The whole feature is conditional on the Task 18A gate.
