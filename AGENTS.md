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
docs/
  protocol/v1.md                published island protocol spec
  errors/<slug>.md              one page per NF code
  guides/self-hosted-skew.md    build retention policy
packages/
  sdk/        logger.ts, error-codes.ts, nf-error.ts, index.ts
  protocol/   constants.ts, envelope.ts, request.ts, props.ts, id-prefix.ts, bootstrap.ts (types), index.ts
  core/       config.ts (defineFederation), fetch-island.ts, events.ts, index.ts,
              identity/ (keys.ts, mint.ts, identity-key.ts, index.ts)   → export "./identity"
  react/      error-boundary.tsx, island-mount.tsx, island-registry.ts, token-client.ts, events.ts, index.ts
  server/     strip-html.ts, identity-verify.ts, identity-context.ts, cors.ts, handler.ts, index.ts,
              node/ (listener.ts, serve-builds.ts, retention.ts, cli.ts) → export "./node", bin "nf-serve"
  island/     bridge-context.tsx, link.tsx, index.client.ts, index.server.ts,
              bootstrap/ (create-bootstrap.tsx, flight-scope.ts, index.ts) → export "./bootstrap"
  vite/       index.ts, options.ts, scope-flight-client.ts, checks.ts,
              plugin-rsc/ (plugin.ts, entry.rsc.tsx, entry.ssr.tsx, entry.client.tsx, css.ts)
  next/       config.ts → "./config"; server/ (create-islands.tsx, island-cache.legacy.ts,
              island-cache.cc.ts, private-envelope.ts) → "./server"; client/next-island-mount.tsx;
              routes.ts → "./routes"; pages/ (create-pages-islands.ts, remote-island.tsx,
              api-handler.ts) → "./pages", "./pages/server"; bridge.ts
test/
  fixtures/island-remote/   Vite remote (names a, b), built with @next-federation/vite
  fixtures/host-app/        App Router host (with and without cacheComponents)
  fixtures/host-pages/      Pages Router host (with and without basePath + i18n)
  fixtures/host-spa/        Vite SPA host (StrictMode on) for lifecycle and skew
  e2e/                      playwright.config.ts, servers.ts, *.spec.ts, fixtures/jwks-server.ts
```

`spike/` is Phase 0 reference code, kept runnable and excluded from lint and Prettier until it is removed.

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
- `pnpm e2e`: Playwright suites (added in Task 15)

## Hard rules

- No Next.js internals: no import of `next/dist/**`; no reference to `__RSC_MANIFEST`, `__next_*`, `__NEXT_*`, `__next_f`, `__next_require__`; never call `connection()`. Enforced by ESLint and `pnpm guardrail` (Task 1); both must pass before every commit.
- Next APIs allowed in `@next-federation/next`, and nowhere else: `fetch` with `next: { revalidate, tags }`; `'use cache'`, `cacheLife`, `cacheTag`, `revalidateTag` (`next/cache`); `cookies()`, `headers()` (`next/headers`); `next/navigation` (incl. `unstable_rethrow`); `next/router`; `next/head`; Route Handlers; Pages API routes; `getServerSideProps`/`getStaticProps`; `next.config` keys `env`, `turbopack.resolveAlias`, `webpack`.
- `sdk`, `protocol`, `core`, `react`, `server`, `island` import no framework (`next`, `vite`, `@vitejs/*`). ESLint enforces it per package.
- All `@vitejs/plugin-rsc*` and `virtual:vite-rsc/*` imports and every `import.meta.viteRsc` use live under `packages/vite/src/plugin-rsc/` only. ESLint enforces it. `@vitejs/plugin-rsc` is pinned to exactly `0.5.39` as a dependency of `@next-federation/vite`.
- The protocol is bundler-neutral. Nothing in `protocol`, `core`, `react`, `server`, `island` may assume Vite. A remote is anything that serves the envelope and a bootstrap ES module honouring `IslandBootstrapModule` (Task 3).
- No dependence on Next/Vercel upstream changes. No `require.cache` patching, no React monkey-patching, no forcing `--webpack`.
- The host never runs remote code on its server. Host cookies are never forwarded to remotes. Identity tokens never appear in HTML, prerendered output, Next's RSC payload, `__NEXT_DATA__`, or any browser storage (memory only).
- Never silently make a static/ISR page dynamic. In `@next-federation/next`, every `catch` around a Next call or a fetch calls `unstable_rethrow(error)` from `next/navigation` first, so Next's control-flow errors are never swallowed.
- Browser globals the library may create: exactly one, `globalThis.__nf_rsc__` (flight-scope registry keyed by a build's absolute base URL). No other `globalThis`/`window` writes in library code. (Finding 1: "no colliding globals".) The Module Federation runtime's own `__FEDERATION__` global is the one permitted third-party global, and only when island React sharing is on (Task 18B).
- Island React sharing (user decision 2026-11-15): islands share `react` and `react-dom` in a Module Federation share scope named `nf-islands`, separate from the host's Mode A scope (`default`, Phase 4). Singletons with **exact-version** matching (`strictVersion`, `requiredVersion` = the remote's exact React version; the RSC wire format is only guaranteed between identical React versions). On a mismatch a remote uses its own bundled copy — sharing is an optimisation, never a requirement, and never couples a remote to the host's React. `react-server-dom-webpack/client` is **never** shared: each build keeps its own flight client and registry slot. Production builds only; dev remotes never share. App Router hosts never provide React (canary). The whole feature is conditional on the Task 18A gate.
