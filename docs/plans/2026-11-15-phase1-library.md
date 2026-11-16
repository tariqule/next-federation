# next-federation Library (Phases 1–2: core, protocol, islands) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 0 spike with real, publishable `@next-federation/*` packages that deliver server-rendered, hydrated RSC islands from separately deployed remotes into Next.js 16 App Router and Pages Router hosts, tested in dev and production under Turbopack and webpack.

**Architecture:** A versioned, bundler-neutral island protocol (JSON envelope: HTML + RSC payload + CSS URLs + bootstrap module URL + `buildId`) sits between a framework-free remote handler and framework-free host pieces (`core` fetch/registry/identity, `react` mount). Thin adapters on top use only public APIs: `@next-federation/next` for hosts, `@next-federation/vite` (wrapping `@vitejs/plugin-rsc`) for remote builds. Islands bring their own React; the host never executes remote code on its server.

**Tech Stack:** TypeScript 6.0.3, pnpm 10 workspace, tsdown (build), rstest (unit), Playwright 1.65 (e2e), changesets, ESLint 9 flat + typescript-eslint, Prettier 3.8. Runtime deps: `jose` 6.2.17, `@module-federation/runtime` 2.9.3 (island React sharing, Tasks 18A–18B). Fixture versions: Next 16.4.6, React 19.3.1, Vite 8.3.8, `@vitejs/plugin-rsc` 0.5.39 (exact pin).

**Spec:** `docs/specs/2026-11-13-federation-lib-design.md` (authority), amended by `docs/spike/phase0-results.md` (overrides the design where they conflict), `docs/specs/2026-11-15-design-changes.md` (the proposed wording of those amendments, pending user approval) and `docs/conventions.md` (mandatory).

**Scope:** Tasks 1–8 are design §10 Phase 1. Tasks 9–25 (including 18A and 18B, island React sharing) are Phase 2. Task 26 is optional and gated on a Vercel account. Phases 3–5 are outlined at the end and get their own plans. Island Server Actions, `<Form>`, Mode A (`RemoteComponent`) are **not** built here.

## Global Constraints

Every task's requirements include this section.

**Hard rules (design §3 anti-goals, §4)**
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

**Fixed values (use verbatim)**
- npm scope `@next-federation/`; log prefix `[ next-federation ]`; error codes `NF-001`… (Task 2 table); docs link base `https://github.com/tariqule/next-federation/blob/main/docs/errors/`.
- Protocol: `PROTOCOL_VERSION = 1`; island path `/_nf/island/<island>`; health path `/_nf/health`; reserved (Phase 3) action path `/_nf/action` and header `X-NF-Action`; GET props limit `2048` base64url characters, above that `POST`.
- Defaults: island fetch timeout `3000` ms total (including retries); retries `1` (network error or 502/503/504 only, 100 ms backoff); public island `revalidate` `60` s; remote public `Cache-Control: public, max-age=60`; token-bearing responses `private, no-store`; token TTL `300` s, browser refresh `30` s before expiry; token algorithm `ES256`; POST body limit `65536` bytes; envelope size dev warning at `102400` bytes; CORS `Access-Control-Max-Age: 600`; CORS allow-headers `Authorization, Content-Type, X-NF-Action`; cache tags `nf:<remote>` and `nf:<remote>:<island>`; stylesheet precedence `next-federation`; host route base `/api/next-federation` (`/jwks`, `/token`).
- Names: remote and island ids match `/^[A-Za-z][A-Za-z0-9_-]*$/`.
- Node floor (user decision: the design's 20.9 wins): every published package declares `engines.node: ">=20.9"` and must **run** on Node 20.9 — build target ES2022, no `import.meta.dirname`, no type-stripping, no other Node ≥ 21 API in `packages/`. CI proves it by running `scripts/smoke-dist.mjs` (plain ESM, no dev tooling) against the built packages on Node 20.9 (Tasks 1, 25). The **development workspace** (pnpm, tsdown, rstest, Playwright, fixtures run with `node file.ts`) requires Node ≥ 24; the root `package.json` keeps `engines.node ">=24"` and `.nvmrc` stays on 24. Peers: `react ^19.0.0`, `next >=16.0.0 <17`, `vite ^8.0.0`.

**Conventions (docs/conventions.md)**
- Prettier `{ "trailingComma": "es5", "singleQuote": true, "semi": false }`. ESLint flat config. No bare `console.*` in `packages/` outside `packages/sdk/src/logger.ts`.
- Unit tests: rstest, `packages/<name>/__tests__/*.spec.ts(x)`. e2e: Playwright under `test/e2e/`, every suite in the four cells `{dev, prod} × {turbopack, webpack}`; `reuseExistingServer: false`. Fixtures are real apps under `test/fixtures/`.
- Every package: `src/`, `__tests__/`, `README.md`, `CHANGELOG.md`, `tsconfig.json`, `tsconfig.lib.json`, `tsdown.config.ts`, `exports` map, `"type": "module"`, `"sideEffects": false`, `publishConfig.access: public`. tsdown runs with `unbundle: true` so `'use client'` and `'use cache'` directives survive per file.
- Every thrown or logged user-facing error is an `NFError` (or `logger.warn/error` with a code) whose message ends with its docs URL; each code has `docs/errors/<slug>.md`.
- Commits: conventional commits. **No mention of Claude or Anthropic, no `Co-Authored-By` or session trailers.** The user commits manually; each task's last step lists the commands.
- Licence: **MIT** (user decision). Root `LICENSE` (MIT, copyright holder: the repository owner) and `"license": "MIT"` in every package; each package's `files` includes a copy of `LICENSE`. Publishing itself is still outside this plan.
- Error docs links are GitHub blob links on the repo (user decision) until a docs site exists; `DOCS_BASE` in `@next-federation/sdk` is the single place to change later.

**Do not copy these spike defects**
- Regex HTML sanitizer as the only cleanup (`spike/proto/src/protocol.ts:109`). → Task 9.
- `identifierPrefix` derived from props (`spike/proto/src/remote-handler.ts:67`). → Tasks 3, 16.
- JWKS URL derived from the token's `iss` (`spike/proto/src/remote-handler.ts:49`). → Task 10.
- Browser token cache keyed by endpoint only, never dropped (`spike/proto/src/island-mount.tsx:80`). → Task 17.
- Envelope `bootstrap`/`css` URLs trusted unchecked. → Tasks 3, 5.
- Debug global `__nf_liveRoots`, bare `console.error`, hard-coded origins/ports in library code, the `?build=` test hook in the versions server, the `nf-test-ttl` cookie hook, key pairs generated per process.
- Manual `export const islandCss` in every island module and manual `basePath`/`locale` props. → Tasks 14, 3.

## Review Focus

Inputs the spec implies but that are easy to leave untested. Each is pinned by a test in the task named.

1. **Two identical islands on one page** (same remote, island and props, so one cached envelope): both must hydrate and keep independent state, with distinct `useId` values. → Task 3 (`applyIdPrefix` test), Task 24 (e2e `/twins`).
2. **A 200 response that is not a valid v1 envelope, or whose `bootstrap`/`css` URL is on a foreign origin** (misconfigured CDN, wrong service behind the URL): the page shows `errorFallback`, logs `NF-004`/`NF-005`, never imports the URL, and the bad result is not cached under `'use cache'`. → Task 5 (unit), Task 19 (unit: failures not cached), Task 20 (unit), Task 24 (e2e `/tampered`).
3. **Props that differ only in key order, contain non-ASCII text, or sit on the 2048 boundary**: same cache key for equal props, correct round-trip, GET→POST switch through a real host. → Task 3 (unit), Task 24 (e2e `/big-props`).
4. **The signed-in user changes or signs out while a browser token is cached** (other tab, session expiry): the old token is never used again. → Task 17 (unit).
5. **A cached envelope points at a build the remote has retired, or the bootstrap fails to load** (ad blocker, CSP, offline): the server HTML stays visible, the island is marked `inert`, an event fires, the host page keeps working. → Task 12 (unit, 410), Task 16 (unit), Task 18 (e2e).

---

## File Structure

**Decision: the `spike/` folder is deleted, not archived in-tree.** Before Task 1 the user tags the spike (`git tag spike-phase-0`), which is the archive. Spike apps move with `git mv` into `test/fixtures/` in the task that ports them (Tasks 15, 18, 22, 23); `spike/proto` and whatever remains are removed in Task 25. Until then `spike/` stays runnable and is excluded from the new lint config. Mode A pieces of the fixtures (`RemoteComponent.tsx`, `/cart`, `spike/spa` MF config, `CartButton`) and island Server Action pieces (`actions.ts`, `AddToCart.tsx`, `Form.tsx`, `actions.spec.ts`) are dropped during the move and come back from the tag in Phases 4 and 3.

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

Dependency direction (no cycles): `sdk` ← `protocol` ← `core`, `server`, `island`, `react` ← `next`, `vite`. `react` depends on `protocol` and `sdk` only. `island` depends on `protocol`, `sdk`, and (server condition only) `server`.

---

# Phase 1 — core + protocol

### Task 1: Workspace tooling, lint guardrails, CI skeleton

**Files:**
- Modify: `package.json`, `pnpm-workspace.yaml`, `.prettierignore`, `.gitignore`, `README.md`
- Create: `LICENSE` (MIT), `scripts/smoke-dist.mjs`, `.prettierrc.json`, `eslint.config.mjs`, `tsconfig.base.json`, `rstest.config.ts`, `.alexrc`, `.changeset/config.json`, `AGENTS.md`, `.github/workflows/ci.yml`, `scripts/check-guardrails.mjs`, `scripts/__tests__/check-guardrails.spec.ts`
- Delete: `.eslintrc.json`, `.prettierrc`

**Interfaces:**
- Produces root scripts: `pnpm build` (`pnpm -r --filter "./packages/*" build`), `pnpm test` (rstest over `packages/*/__tests__` and `scripts/__tests__`), `pnpm typecheck` (`tsc -b`), `pnpm lint` (`eslint .`), `pnpm guardrail` (`node scripts/check-guardrails.mjs`), `pnpm format:check`, `pnpm e2e` (added in Task 15).
- Produces `scripts/check-guardrails.mjs`: `export function findViolations(files: Array<{ path: string; text: string }>): Array<{ path: string; line: number; rule: string }>`; CLI scans tracked files under `packages/` and `test/fixtures/` (not `**/AGENTS.md`, `**/next-env.d.ts`, `test/e2e/**`), exits 1 and prints `path:line rule` per violation.
- Workspace globs: `packages/*`, `test/fixtures/*`, `test/e2e`, and (until Task 25) `spike/*`.

- [ ] **Step 1: Tag the spike** (user runs): `git tag spike-phase-0 && git switch -c feat/phase-1`

- [ ] **Step 2: Write the failing guardrail test** in `scripts/__tests__/check-guardrails.spec.ts`

```ts
const scan = (text: string, path = 'packages/next/src/x.ts') =>
  findViolations([{ path, text }]).map((v) => v.rule)

test('flags each banned pattern', () => {
  expect(scan(`import x from 'next/dist/server/foo'`)).toEqual(['next-internal-import'])
  expect(scan('self.__next_f.push(1)')).toEqual(['next-internal-global'])
  expect(scan('globalThis.__RSC_MANIFEST')).toEqual(['next-internal-global'])
  expect(scan('process.env.__NEXT_CACHE_COMPONENTS')).toEqual(['next-internal-global'])
  expect(scan('await connection()')).toEqual(['connection-call'])
})
test('does not flag look-alikes', () => {
  expect(scan('const connectionString = makeConnection(url)')).toEqual([])
  expect(scan(`import { cookies } from 'next/headers'`)).toEqual([])
})
test('reports 1-based line numbers', () => {
  expect(findViolations([{ path: 'a.ts', text: 'ok\nawait connection()' }])[0].line).toBe(2)
})
```

- [ ] **Step 3: Run it** — `pnpm exec rstest scripts/__tests__` → FAIL (`findViolations` not found).

- [ ] **Step 4: Implement `scripts/check-guardrails.mjs`.** Rules: `next-internal-import` = `/['"]next\/dist\//`; `next-internal-global` = `/__RSC_MANIFEST|__next_[a-z]\w*|__NEXT_[A-Z]\w*|__next_f\b/` except the literal `__NEXT_DATA__` inside `test/`; `connection-call` = `/(?<![\w.])connection\s*\(/`.

- [ ] **Step 5: Write the tooling config.**
  - `.prettierrc.json`: `{ "trailingComma": "es5", "singleQuote": true, "semi": false }`.
  - `eslint.config.mjs` (flat, `typescript-eslint` recommended). Ignores: `**/dist/**`, `**/.next*/**`, `spike/**`, `**/next-env.d.ts`. Rules for `packages/**`: `no-console: error` (off for `packages/sdk/src/logger.ts`); `no-restricted-imports` patterns `next/dist/*`, `next/dist/**` (message: `next-federation must not import Next.js internals (design §3).`); `no-restricted-syntax` for `CallExpression[callee.name='connection']`. Per-package import bans: `next`, `next/*`, `vite`, `@vitejs/*` in `packages/{sdk,protocol,core,react,server,island}/**`; `@vitejs/plugin-rsc`, `@vitejs/plugin-rsc/*`, `virtual:vite-rsc/*` everywhere except `packages/vite/src/plugin-rsc/**`.
  - `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `module: "preserve"`, `moduleResolution: "bundler"`, `target: "ES2022"`, `jsx: "react-jsx"`, `verbatimModuleSyntax`, `isolatedDeclarations: true`.
  - `rstest.config.ts`: node environment, `include: ['packages/*/__tests__/**/*.spec.{ts,tsx}', 'scripts/__tests__/*.spec.ts']`, `testTimeout: 10000`. Packages needing a DOM (Task 8, 16, 17) set `testEnvironment: 'happy-dom'` in a package-level project entry.
  - `.changeset/config.json`: `access: "public"`, `baseBranch: "main"`, all `@next-federation/*` in one `fixed` group; `ignore` the fixtures and e2e.
  - `package.json`: `engines.node ">=24"`, the scripts above, devDependencies added with exact versions resolved at install time: `tsdown`, `@rstest/core`, `happy-dom`, `@changesets/cli`, `typescript-eslint`, `publint`, `alex`.
  - `AGENTS.md`: repo map (the File Structure tree), commands, the Global Constraints "Hard rules" verbatim, "read the package README before editing".
  - `.github/workflows/ci.yml`: one job `check` on Node 24: `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm guardrail`, `pnpm typecheck`, `pnpm build`, `pnpm test`, then upload `packages/*/dist` as an artifact; a second job `node-floor` on **Node 20.9** downloads the artifact, runs `npm install --omit=dev` style production install of the packages' runtime deps, and runs `node scripts/smoke-dist.mjs`. (e2e jobs are added in Task 25.)
  - `scripts/smoke-dist.mjs`: plain ESM, no TypeScript, no test runner. Imports every `packages/*/dist` entry listed in each `exports` map and exits 1 on any import error. Each later task that adds a server-side package appends one behavioural check to it (Task 3: encode → decode round trip; Task 6 + 10: mint → verify; Task 11: handler returns a parseable envelope; Task 12: `planRetention`). Browser-only entries (`react`, `island/bootstrap`) are import-checked only.

- [ ] **Step 6: Verify** — `pnpm install && pnpm test && pnpm lint && pnpm guardrail && pnpm format:check`. Expected: 3 tests pass; lint and guardrail report 0 problems (no packages yet); `format:check` passes after one `pnpm format` run.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: workspace tooling, flat eslint, guardrail script, ci skeleton"
```

### Task 2: `@next-federation/sdk` — logger, error codes, `NFError`

**Files:**
- Create: `packages/sdk/{package.json,tsconfig.json,tsconfig.lib.json,tsdown.config.ts,README.md,CHANGELOG.md}`, `packages/sdk/src/{index.ts,logger.ts,error-codes.ts,nf-error.ts}`, `packages/sdk/__tests__/{logger.spec.ts,nf-error.spec.ts}`, `docs/errors/*.md` (one per code), `scripts/check-error-docs.mjs`

**Interfaces — Produces:**

```ts
export const DOCS_BASE = 'https://github.com/tariqule/next-federation/blob/main/docs/errors/'
export const ERROR_CODES: Record<NFErrorCode, { slug: string; title: string }>
export type NFErrorCode = 'NF-001' | … | 'NF-025'
export function errorDocsUrl(code: NFErrorCode): string            // DOCS_BASE + slug + '.md'
export function formatError(code: NFErrorCode, detail?: string): string
// → `NF-001: Unknown remote. ${detail} See ${url}`  (detail segment omitted when absent)
export class NFError extends Error {
  readonly code: NFErrorCode; readonly docs: string
  constructor(code: NFErrorCode, detail?: string, options?: { cause?: unknown })
}
export function isNFError(value: unknown, code?: NFErrorCode): value is NFError  // duck-typed on .code, survives duplicate package copies
export type LogSink = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>
export type Logger = {
  debug(...a: unknown[]): void; info(...a: unknown[]): void
  warn(code: NFErrorCode, detail?: string): void; error(code: NFErrorCode, detail?: string, cause?: unknown): void
  warnOnce(code: NFErrorCode, key: string, detail?: string): void
}
export function createLogger(prefix: string, sink?: LogSink): Logger
export const logger: Logger            // createLogger('[ next-federation ]')
```

`debug` prints only when `process.env.NF_DEBUG` is set (guard `typeof process`).

Error table (slug = file name under `docs/errors/`; each page has: what happened, why, how to fix):

| Code | Slug | Title |
|---|---|---|
| NF-001 | unknown-remote | Unknown remote |
| NF-002 | invalid-config | Invalid federation configuration |
| NF-003 | unsupported-protocol-version | Unsupported island protocol version |
| NF-004 | invalid-envelope | Invalid island envelope |
| NF-005 | envelope-url-not-allowed | Envelope URL is outside the remote's origins |
| NF-006 | react-mode-mismatch | Island server and client bundle run different React modes |
| NF-007 | island-fetch-failed | Island fetch failed |
| NF-008 | island-fetch-timeout | Island fetch timed out |
| NF-009 | props-not-json | Island props are not plain JSON |
| NF-010 | build-mismatch | Envelope was rendered by a different build than this bootstrap |
| NF-011 | bootstrap-load-failed | Island bootstrap failed to load |
| NF-012 | island-runtime-error | Uncaught error inside an island |
| NF-013 | identity-not-configured | Private island used without identity configuration |
| NF-014 | invalid-token | Identity token rejected |
| NF-015 | jwks-unavailable | Issuer JWKS could not be fetched |
| NF-016 | issuer-not-allowed | Token issuer is not in the remote's issuer map |
| NF-017 | next-config-wrapper-missing | `withNextFederation` is missing from next.config |
| NF-018 | island-html-stripped | Island rendered a script or hoistable element |
| NF-019 | server-actions-unsupported | Island Server Actions are not available in this release |
| NF-020 | relative-base | Remote `base` must be an absolute URL |
| NF-021 | unknown-island | Unknown island |
| NF-022 | origin-not-allowed | Request origin is not an allowed host |
| NF-023 | build-retired | Remote build has been retired |
| NF-024 | envelope-too-large | Island envelope exceeds the size warning threshold |
| NF-025 | unsupported-plugin-rsc | Unsupported `@vitejs/plugin-rsc` version |

- [ ] **Step 1: Write failing tests**

```ts
// nf-error.spec.ts
test('message carries code, title, detail and docs link', () => {
  const e = new NFError('NF-001', 'Remote "shop" is not in defineFederation().')
  expect(e.message).toBe(
    'NF-001: Unknown remote. Remote "shop" is not in defineFederation(). See https://github.com/tariqule/next-federation/blob/main/docs/errors/unknown-remote.md'
  )
  expect(e.code).toBe('NF-001'); expect(e.name).toBe('NFError'); expect(isNFError(e, 'NF-001')).toBe(true)
  expect(isNFError({ code: 'NF-001', message: 'x' })).toBe(true); expect(isNFError(new Error('x'))).toBe(false)
})
test('codes are contiguous NF-001..NF-025 with unique slugs', () => { /* assert on Object.keys(ERROR_CODES) */ })
// logger.spec.ts — with a fake sink
test('prefixes every line', () => { log.warn('NF-024', 'x'); expect(sink.warn).toHaveBeenCalledWith('[ next-federation ]', expect.stringContaining('NF-024')) })
test('warnOnce logs once per key', () => { log.warnOnce('NF-024','k'); log.warnOnce('NF-024','k'); expect(sink.warn).toHaveBeenCalledTimes(1) })
test('debug is silent unless NF_DEBUG is set', () => { … })
```

- [ ] **Step 2: Run** `pnpm exec rstest packages/sdk` → FAIL (module not found).
- [ ] **Step 3: Implement** the four source files and the package scaffold. This package's scaffold (package.json `exports` → `./dist/index.js` + types, `tsdown.config.ts` with `unbundle: true`, `dts: true`, `format: 'esm'`, two tsconfigs) is the template every later package copies (`"license": "MIT"`, `engines.node ">=20.9"`).
- [ ] **Step 4: Write the 25 `docs/errors/<slug>.md` pages and `scripts/check-error-docs.mjs`** (imports the built `ERROR_CODES`, fails if a page is missing or orphaned). Add it to `pnpm guardrail`.
- [ ] **Step 5: Verify** — `pnpm --filter @next-federation/sdk build && pnpm exec rstest packages/sdk && pnpm guardrail && pnpm exec publint packages/sdk`. Expected: all tests pass, guardrail 0 violations, publint no errors.
- [ ] **Step 6: Commit**

```bash
git add packages/sdk docs/errors scripts package.json pnpm-lock.yaml
git commit -m "feat(sdk): category logger, NF error codes and docs pages"
```

### Task 3: `@next-federation/protocol` — wire format v1 and the published spec

**Files:**
- Create: `packages/protocol/` scaffold; `src/{constants,envelope,props,request,id-prefix,bootstrap,index}.ts`; `__tests__/{envelope,props,request,id-prefix,spec-doc}.spec.ts`; `docs/protocol/v1.md`
- Reference (port, don't copy defects): `spike/proto/src/protocol.ts`, `spike/proto/__tests__/protocol.spec.ts`

**Interfaces — Consumes:** `NFError` (Task 2). **Produces:**

```ts
export const PROTOCOL_VERSION = 1
export const ISLAND_PATH = '/_nf/island/'; export const HEALTH_PATH = '/_nf/health'
export const ACTION_PATH = '/_nf/action'   // reserved for Phase 3
export const GET_PROPS_LIMIT = 2048
export const NAME_PATTERN: RegExp          // /^[A-Za-z][A-Za-z0-9_-]*$/
export type ReactMode = 'development' | 'production'
export type HostContext = { basePath: string; locale: string }   // locale = URL prefix segment, '' for none/default
export type IslandEnvelope = {
  protocolVersion: 1
  remote: string            // remote's own name
  buildId: string
  mode: ReactMode           // React mode of the server that rendered (finding 9)
  html: string
  rscPayload: string
  css: string[]             // absolute URLs
  bootstrap: string         // absolute URL of an ES module implementing IslandBootstrapModule
  reactVersion: string
  idPlaceholder: string     // token in html/rscPayload the host replaces with a per-mount prefix
}
export function parseEnvelope(json: unknown): IslandEnvelope
//  NF-003 if protocolVersion !== 1 (checked first); NF-004 for any missing/mistyped field,
//  non-absolute bootstrap/css URL, or mode outside the union. Unknown extra fields are kept and ignored.
export function assertEnvelopeUrls(envelope: IslandEnvelope, allowedOrigins: readonly string[]): void
//  NF-005 unless new URL(u).origin is in allowedOrigins for bootstrap and every css entry; http(s) only.
export function canonicalJson(value: unknown): string
//  Sorted object keys, no whitespace. NF-009 for function, symbol, bigint, undefined-valued array slot,
//  NaN/Infinity, Date, Map/Set, class instances, cycles. Object properties whose value is undefined are dropped.
export type EncodedIslandRequest = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }
export function encodeIslandRequest(base: string, island: string, props: unknown,
  opts?: { token?: string; host?: HostContext }): EncodedIslandRequest
//  url = `${base without trailing /}/_nf/island/${island}`; GET `?p=<b64url canonicalJson(props)>&h=<b64url canonicalJson(host)>`
//  (h omitted when host is absent or { basePath: '', locale: '' }); when p.length > 2048: POST, content-type
//  application/json, body canonicalJson({ props, host }), no p/h in the URL. Authorization: Bearer only with token.
//  NF-002 if island fails NAME_PATTERN.
export function decodeIslandRequest(req: Request): Promise<{ island: string; props: unknown; host: HostContext }>
//  Island = path segment after the LAST '/_nf/island/'. NF-004 on bad path, bad base64/JSON, non-object host.
export function applyIdPrefix(envelope: Pick<IslandEnvelope, 'html' | 'rscPayload' | 'idPlaceholder'>, mountId: string):
  { html: string; rscPayload: string; identifierPrefix: string }
//  identifierPrefix = idPlaceholder + mountId.replace(/[^A-Za-z0-9]/g, '') + '-'; replaces every idPlaceholder occurrence.

// Bootstrap module contract (the bundler-neutral browser half of the protocol)
export type IslandBridge = { navigate(href: string): void; prefetch(href: string): void; basePath: string; locale: string }
export type IslandErrorKind = 'uncaught' | 'caught' | 'recoverable'
export type MountIslandOptions = {
  envelope: Pick<IslandEnvelope, 'remote' | 'buildId' | 'mode'>
  rscPayload: string; identifierPrefix: string          // already prefixed by the host
  bridge: IslandBridge
  getToken?: () => Promise<string | null>               // used from Phase 3
  onError?: (error: unknown, kind: IslandErrorKind) => void
}
export type IslandHandle = { update(next: { rscPayload: string }): void; destroy(): void }
export type IslandBootstrapModule = { mountIsland(container: HTMLElement, options: MountIslandOptions): IslandHandle }
```

- [ ] **Step 1: Write failing tests** (port the spike's protocol tests to the new names, then add):

```ts
// envelope.spec.ts
const valid = { protocolVersion: 1, remote: 'a', buildId: 'v1', mode: 'production', html: '<p>x</p>', rscPayload: '0:x',
  css: ['https://r.example/a.css'], bootstrap: 'https://r.example/b.js', reactVersion: '19.3.1', idPlaceholder: 'nfid-1a2b3c4d-' }
test('accepts a valid envelope and keeps unknown fields', () => expect(parseEnvelope({ ...valid, future: 1 })).toMatchObject(valid))
test('unknown major version is NF-003, before field checks', () => expect(() => parseEnvelope({ protocolVersion: 2 })).toThrow(/NF-003/))
test.each(['remote','buildId','mode','html','rscPayload','css','bootstrap','reactVersion','idPlaceholder'])('missing %s is NF-004', …)
test('relative bootstrap is NF-004', …)
test('bootstrap on a foreign origin is NF-005', () =>
  expect(() => assertEnvelopeUrls({ ...valid, bootstrap: 'https://evil.example/b.js' }, ['https://r.example'])).toThrow(/NF-005/))
test('css on an allowed asset origin passes', …); test('javascript: and data: URLs are NF-005', …)
// props.spec.ts
test('key order does not change the output', () => expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}'))
test.each([[() => 1], [1n], [new Date(0)], [new Map()], [NaN], [Symbol('x')]])('rejects %p with NF-009', …)
test('rejects cycles with NF-009', …)
// request.spec.ts
test('round-trips unicode props and host context over GET', async () => {
  const r = encodeIslandRequest('https://r.example', 'Panel', { t: 'héllo ✓ 日本' }, { host: { basePath: '/base', locale: 'fr' } })
  expect(r.method).toBe('GET')
  expect(await decodeIslandRequest(new Request(r.url))).toEqual({ island: 'Panel', props: { t: 'héllo ✓ 日本' }, host: { basePath: '/base', locale: 'fr' } })
})
test('equal props in different key order give the same URL', …)
test('p of exactly 2048 chars is GET; 2049 is POST with a JSON body and no query', …)
test('decodes a build-pinned path /b/v1/_nf/island/Panel', …)
test('token becomes a Bearer header and never appears in the URL or body', …)
test('island name "../x" is NF-002', …)
// id-prefix.spec.ts  (Review Focus 1)
test('two mounts of one envelope get distinct prefixes and no placeholder remains', () => {
  const env = { html: '<i id="nfid-1a2b3c4d-R1"></i>', rscPayload: '"nfid-1a2b3c4d-R1"', idPlaceholder: 'nfid-1a2b3c4d-' }
  const a = applyIdPrefix(env, '«r1»'), b = applyIdPrefix(env, '«r2»')
  expect(a.identifierPrefix).toBe('nfid-1a2b3c4d-r1-'); expect(a.html).toBe('<i id="nfid-1a2b3c4d-r1-R1"></i>')
  expect(a.rscPayload).toBe('"nfid-1a2b3c4d-r1-R1"'); expect(b.identifierPrefix).not.toBe(a.identifierPrefix)
})
```

- [ ] **Step 2: Run** `pnpm exec rstest packages/protocol` → FAIL.
- [ ] **Step 3: Implement.** base64url must be browser- and Node-safe (`TextEncoder` + `btoa`, no `Buffer`), as in the spike. No dependency other than `@next-federation/sdk`.
- [ ] **Step 4: Write `docs/protocol/v1.md`** — sections: Versioning (integer major; additive fields are compatible; unknown major → fallback + `NF-003`); Island request (GET/POST, `p`, `h`, headers, no cookies); Response envelope (field table above); Status codes (the table in Task 11); Caching headers; Bootstrap module contract (`mountIsland`, `IslandHandle`, the rule that a bootstrap must be safe next to other remotes' and other builds' bootstraps on one page); Build pinning (all URLs absolute and build-pinned); Identity (Bearer JWT, ES256, `aud` = remote name); Reserved: `/_nf/action`, `X-NF-Action`; a "writing a remote without Vite" note. Include one complete example envelope in a ```` ```json ```` block.
- [ ] **Step 5: Add `spec-doc.spec.ts`** — reads `docs/protocol/v1.md`, extracts the first `json` block, asserts `parseEnvelope` accepts it. Run all protocol tests → PASS.
- [ ] **Step 6: Commit**

```bash
git add packages/protocol docs/protocol
git commit -m "feat(protocol): island protocol v1 codec, bootstrap contract and published spec"
```

### Task 4: `@next-federation/core` — `defineFederation` and events

**Files:**
- Create: `packages/core/` scaffold; `src/{config,events,index}.ts`; `__tests__/config.spec.ts`

**Interfaces — Consumes:** `NFError`, `NAME_PATTERN`. **Produces:**

```ts
export type RemoteConfig = { origin: string; assetOrigins?: string[]; timeoutMs?: number; retries?: number }
export type FederationConfig = {
  remotes: Record<string, RemoteConfig>
  islands?: { revalidate?: number; timeoutMs?: number; retries?: number; warnBytes?: number }
  identity?: { issuer: string; signingKeys: string | string[]; ttlSeconds?: number }
  routesPath?: string                         // default '/api/next-federation'
  onEvent?: (event: FederationEvent) => void
}
/** Plain, serializable description of one remote: safe as a 'use cache' argument. */
export type IslandTarget = { remote: string; origin: string; allowedOrigins: string[]; timeoutMs: number; retries: number }
export type Federation = {
  readonly remotes: readonly string[]
  target(remote: string): IslandTarget                 // NF-001 when unknown
  readonly islands: { revalidate: number; warnBytes: number }
  readonly identity: { issuer: string; signingKeys: string[]; ttlSeconds: number } | null
  readonly routesPath: string
  emit(event: FederationEvent): void                   // never throws; a throwing onEvent is logged and swallowed
}
export function defineFederation(config: FederationConfig): Federation
export type FederationEvent =
  | { type: 'island:fetch'; remote: string; island: string; ms: number; bytes: number; attempts: number }
  | { type: 'island:error'; remote: string; island: string; ms: number; attempts: number; code: NFErrorCode; status?: number }
```

Validation (all `NF-002`, message names the offending key): remote names match `NAME_PATTERN`; `origin` is an absolute http(s) URL with no path, query or trailing slash after normalisation (`new URL(origin).origin`); `assetOrigins` likewise; numbers finite and ≥ 0; `identity.issuer` absolute URL; `routesPath` starts with `/`. `allowedOrigins = [origin, ...assetOrigins]`. Defaults from Global Constraints.

- [ ] **Step 1: Failing tests**

```ts
test('resolves defaults', () => {
  const f = defineFederation({ remotes: { shop: { origin: 'https://shop.example.com/' } } })
  expect(f.target('shop')).toEqual({ remote: 'shop', origin: 'https://shop.example.com',
    allowedOrigins: ['https://shop.example.com'], timeoutMs: 3000, retries: 1 })
  expect(f.islands).toEqual({ revalidate: 60, warnBytes: 102400 }); expect(f.identity).toBeNull()
  expect(f.routesPath).toBe('/api/next-federation')
})
test('per-remote values override islands defaults', …)
test('unknown remote is NF-001 and names the remote', () => expect(() => f.target('nope')).toThrow(/NF-001.*"nope"/))
test.each([['bad name', { remotes: { 'a b': { origin: 'https://x.example' } } }],
           ['origin with path', { remotes: { a: { origin: 'https://x.example/app' } } }],
           ['relative origin', { remotes: { a: { origin: '/x' } } }],
           ['negative timeout', { remotes: { a: { origin: 'https://x.example', timeoutMs: -1 } } }]])('%s is NF-002', …)
test('a throwing onEvent does not propagate', …)
test('target() output survives JSON round-trip unchanged', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm exec rstest packages/core` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): defineFederation registry, validation and events"
```

### Task 5: `@next-federation/core` — `fetchIsland` (timeout, retries, validation)

**Files:**
- Create: `packages/core/src/fetch-island.ts`; `packages/core/__tests__/fetch-island.spec.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces — Consumes:** `IslandTarget` (Task 4); `encodeIslandRequest`, `parseEnvelope`, `assertEnvelopeUrls`, `HostContext` (Task 3). **Produces:**

```ts
export type IslandFetchMeta = { ms: number; bytes: number; attempts: number }
export type IslandResult =
  | { ok: true; envelope: IslandEnvelope; meta: IslandFetchMeta }
  | { ok: false; code: 'NF-003' | 'NF-004' | 'NF-005' | 'NF-007' | 'NF-008'; status?: number; meta: IslandFetchMeta }
export type FetchIslandRequest = {
  island: string; props?: unknown; host?: HostContext; token?: string
  fetch?: typeof fetch                    // injected; default globalThis.fetch
  init?: Record<string, unknown>          // merged into every fetch call, e.g. { next: { revalidate, tags } } or { cache: 'no-store' }
}
export function fetchIsland(target: IslandTarget, request: FetchIslandRequest): Promise<IslandResult>
export function eventFor(target: IslandTarget, island: string, result: IslandResult): FederationEvent
```

Behaviour: never rejects for network/remote/validation failures (returns `ok: false`); **does** throw `NF-009`/`NF-002` for caller mistakes (bad props, bad island name). Rethrows any error the injected `fetch` throws that is not an `AbortError`/`TimeoutError`/`TypeError` (so framework control-flow errors pass through). One total budget of `target.timeoutMs`: each attempt gets `AbortSignal.timeout(remaining)`; timeout → `NF-008`, no retry. Retry (up to `target.retries`) only on a thrown network error or status 502/503/504, after 100 ms, and only if budget remains. Other non-2xx → `NF-007` with `status`, no retry. A 2xx body goes through `parseEnvelope`, then `assertEnvelopeUrls(envelope, target.allowedOrigins)`, then `envelope.remote === target.remote` (else `NF-004`). `bytes` = response text length. `credentials: 'omit'` always; no cookie header is ever set.

- [ ] **Step 1: Failing tests** (fake `fetch`, fake timers)

```ts
test('returns the envelope on 200', …)                          // ok: true, attempts 1
test('sends no cookies and omits credentials', …)               // init.credentials === 'omit'; no cookie header
test('retries once on 503 then succeeds', …)                    // attempts 2
test('retries once on a network TypeError', …)
test('does not retry 404; returns NF-007 with status 404', …)
test('a remote slower than the budget returns NF-008 at ~3000 ms and is not retried', …)
test('budget is shared across attempts', …)                     // 503 at 2900 ms → no second attempt past 3000
test('invalid JSON body is NF-004', …); test('protocolVersion 2 is NF-003', …)
test('bootstrap on a foreign origin is NF-005', …)              // Review Focus 2
test('css on a configured assetOrigin is accepted', …)
test('envelope.remote that differs from the target is NF-004', …)
test('passes init.next through to fetch untouched', …)
test('a non-network error thrown by fetch is rethrown', …)      // e.g. an object with digest 'NEXT_…' shape
test('eventFor maps ok→island:fetch and failure→island:error with code and status', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm exec rstest packages/core` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): fetchIsland with timeout budget, retries and envelope validation"
```

### Task 6: `@next-federation/core/identity` — host keys, token minting, JWKS

**Files:**
- Create: `packages/core/src/identity/{keys,mint,identity-key,index}.ts`; `packages/core/__tests__/identity.spec.ts`
- Modify: `packages/core/package.json` (`exports["./identity"]`, dependency `jose: 6.2.17`)
- Reference: `spike/proto/src/identity.ts`

**Interfaces — Consumes:** `Federation` (Task 4). **Produces** (`@next-federation/core/identity`; server-only by documentation, uses Web Crypto via `jose`):

```ts
export type HostIdentity = { sub: string; claims?: Record<string, unknown> }
export function generateSigningKey(kid?: string): Promise<string>     // JSON string of a private ES256 JWK incl. kid; kid defaults to a random 8-hex id
export function publicJwks(federation: Federation): Promise<{ keys: JWK[] }>   // public parts of ALL signingKeys, each with kid, alg: 'ES256', use: 'sig'
export function mintIslandToken(federation: Federation, opts: { remote: string; identity: HostIdentity; ttlSeconds?: number }):
  Promise<{ token: string; expiresAt: number }>                       // expiresAt = epoch seconds
export function identityKey(federation: Federation, sub: string): Promise<string>
//  Opaque per-user marker safe to put in HTML: base64url(HMAC-SHA256(key = SHA-256 of the first signing key's `d`, msg = sub)).slice(0, 22)
```

Rules: signs with the **first** key in `signingKeys` (`kid` in the header); `iss` = `federation.identity.issuer`, `aud` = remote name, `sub`, `iat`, `exp`. `claims` may not contain `iss|aud|sub|exp|iat|nbf|jti` (`NF-002`). `NF-013` if `federation.identity` is null; `NF-001` for an unknown remote; `NF-002` if a signing key is not a private ES256 JWK with a `kid`, or two keys share a `kid`. Parsed keys are cached per `Federation` in a `WeakMap`.

- [ ] **Step 1: Failing tests**

```ts
test('mints an ES256 token with iss, aud, sub, exp = iat + 300 and the kid of the first key', …)   // verify with jose + publicJwks()
test('publicJwks lists every key and contains no private member "d"', …)
test('a token signed by the older second key still verifies against publicJwks (rotation)', …)
test('reserved claim names are NF-002', …)
test('no identity config is NF-013', …)
test('identityKey is stable per sub, differs across subs and signing keys, and does not contain the sub', …)
test('generateSigningKey output is accepted by defineFederation + mintIslandToken', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): host identity keys, island token minting and JWKS"
```

### Task 7: `@next-federation/react` — error boundary and fallbacks

**Files:**
- Create: `packages/react/` scaffold (peer `react ^19.0.0`, `react-dom ^19.0.0`; rstest project with `happy-dom`); `src/{error-boundary.tsx,index.ts}`; `__tests__/error-boundary.spec.tsx`

**Interfaces — Produces:**

```ts
'use client'
export type FederationErrorBoundaryProps = {
  fallback: ReactNode | ((error: unknown) => ReactNode)
  onError?: (error: unknown) => void
  resetKey?: unknown            // boundary resets when this value changes
  children: ReactNode
}
export class FederationErrorBoundary extends Component<FederationErrorBoundaryProps, { error: unknown; resetKey: unknown }>
```

- [ ] **Step 1: Failing tests** (render with `react-dom/client` + `act`)

```ts
test('renders children when nothing throws', …)
test('renders the fallback and calls onError once when a child throws', …)
test('a function fallback receives the error', …)
test('changing resetKey renders children again', …)
test('built file keeps the "use client" directive', () =>
  expect(readFileSync('packages/react/dist/error-boundary.js', 'utf8')).toMatch(/^['"]use client['"]/))
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (class component, `getDerivedStateFromError`, `getDerivedStateFromProps` for `resetKey`). **Step 4:** `pnpm --filter @next-federation/react build && pnpm exec rstest packages/react` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/react
git commit -m "feat(react): federation error boundary with fallback and reset"
```

### Task 8: Phase 1 exit — publish-readiness of `sdk`, `protocol`, `core`, `react`

**Files:**
- Modify: the four packages' `README.md` (purpose, install, API table, link to `docs/protocol/v1.md`), root `README.md`
- Create: `.changeset/phase-1.md` (minor bump, all four)

**Interfaces:** none new.

- [ ] **Step 1: Verify** — `pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm guardrail && for p in sdk protocol core react; do pnpm exec publint packages/$p; done`. Expected: all green; publint reports no errors for any package.
- [ ] **Step 2: Check the layering** — `pnpm exec eslint packages/{sdk,protocol,core,react}` reports 0 problems, and `grep -rn "from 'next\|from 'vite" packages/{sdk,protocol,core,react}/src` prints nothing.
- [ ] **Step 3: Commit** (Phase 1 exit criteria met: unit tests green, spec published at `docs/protocol/v1.md`)

```bash
git add packages README.md .changeset
git commit -m "docs: package readmes and changeset for core, protocol, react, sdk"
```

---

# Phase 2 — islands

### Task 9: `@next-federation/server` — island HTML stripper (tokenizer)

**Files:**
- Create: `packages/server/` scaffold; `src/strip-html.ts`; `__tests__/strip-html.spec.ts`

**Interfaces — Produces:**

```ts
export type StrippedTag = { tag: 'script' | 'link' | 'meta' | 'title' | 'base' | 'style'; attrs: string }
export function stripIslandHtml(html: string): { html: string; removed: StrippedTag[] }
```

A single-pass HTML tokenizer (states: data, tag open, tag name, attributes with quoted values, comment, raw text), not a regex. Removes: `<script>…</script>` (whole element), `<link>`, `<meta>`, `<base>`, `<title>…</title>` when not inside `<svg>`, and `<style>` only when it has a `precedence` or `href` attribute. Everything else is emitted byte-for-byte. Raw-text elements (`script`, `style`, `textarea`, `title`) are consumed to their matching close tag (case-insensitive); an unterminated removed element drops the rest of the input. This is cleanup of framework output so React in the host never sees a hoistable. It is **not** a security boundary — say so in the doc comment and README (hosts only accept envelopes from allowlisted remotes).

- [ ] **Step 1: Failing tests**

```ts
const strip = (h: string) => stripIslandHtml(h).html
test('removes script elements with their content', () => expect(strip('<p>a</p><script>x("</p>")</script><p>b</p>')).toBe('<p>a</p><p>b</p>'))
test('removes modulepreload links and reports them', () => {
  const r = stripIslandHtml('<link rel="modulepreload" href="/a.js"/><div>x</div>')
  expect(r.html).toBe('<div>x</div>'); expect(r.removed).toEqual([{ tag: 'link', attrs: ' rel="modulepreload" href="/a.js"/' }])
})
test('removes meta, base and title', …)
test('keeps <title> inside <svg>', () => expect(strip('<svg><title>t</title></svg>')).toBe('<svg><title>t</title></svg>'))
test('keeps plain <style> and removes <style precedence>', …)
test('a ">" inside a quoted attribute does not end the tag', () =>
  expect(strip('<a title="x > <script>y</script>">k</a>')).toBe('<a title="x > <script>y</script>">k</a>'))
test('escaped text is untouched', () => expect(strip('<p>&lt;script&gt;1&lt;/script&gt;</p>')).toBe('<p>&lt;script&gt;1&lt;/script&gt;</p>'))
test('is case-insensitive', () => expect(strip('<SCRIPT>1</ScRiPt>ok')).toBe('ok'))
test('comments are preserved verbatim, including a script inside one', …)
test('textarea content that looks like a tag is preserved', …)
test('an unterminated script drops the remainder', () => expect(strip('<p>a</p><script>never closed')).toBe('<p>a</p>'))
test('output of React SSR without hoistables is byte-identical', …)   // a realistic fixture string with <!-- --> markers
```

- [ ] **Step 2: Run** `pnpm exec rstest packages/server` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): tokenizer-based island html stripper"
```

### Task 10: `@next-federation/server` — token verification and identity context

**Files:**
- Create: `packages/server/src/{identity-verify,identity-context}.ts`; `__tests__/{identity-verify,identity-context}.spec.ts`
- Modify: `packages/server/package.json` (dependency `jose: 6.2.17`)
- Reference: `spike/proto/src/identity.ts`, `spike/proto/__tests__/identity.spec.ts` (HTTP JWKS server pattern)

**Interfaces — Produces:**

```ts
export type IslandIdentity = { sub: string; [claim: string]: unknown }
export type IssuerMap = Record<string, string>          // issuer (exact `iss` value) → JWKS URL. From configuration only.
export type IdentityOutcome =
  | { kind: 'anonymous' }
  | { kind: 'verified'; identity: IslandIdentity }
  | { kind: 'invalid'; code: 'NF-014' | 'NF-016' }
  | { kind: 'unavailable' }                             // NF-015
export function createIdentityVerifier(opts: { audience: string; issuers: IssuerMap }): (req: Request) => Promise<IdentityOutcome>
export function runWithIdentity<T>(identity: IslandIdentity | null, fn: () => Promise<T>): Promise<T>
export function getIdentity(): IslandIdentity | null
```

Rules: no `Authorization` header → `anonymous`. Header not `Bearer <jwt>` → `invalid NF-014`. The token's unverified `iss` is used **only as a lookup key** into `issuers`; a miss → `invalid NF-016`; no URL is ever built from token content. Verification: `jwtVerify` with `algorithms: ['ES256']`, `audience`, `issuer`, required string `sub`; JWKS via `createRemoteJWKSet(url, { timeoutDuration: 2000 })`, one set per URL per verifier. Network failure or `JWKSTimeout` → `unavailable`; every other failure → `invalid NF-014`. The `AsyncLocalStorage` behind `getIdentity` is stored at `globalThis[Symbol.for('next-federation.identity')]` so duplicate copies of this package in one server bundle share it (server-side only; `node:async_hooks`).

- [ ] **Step 1: Failing tests** (real local HTTP JWKS server; tokens from `@next-federation/core/identity` as a devDependency)

```ts
test('no header is anonymous', …)
test('a valid token is verified and exposes sub and custom claims', …)
test('a token for another audience is NF-014', …)
test('an expired token is NF-014', …)
test('alg none / HS256 tokens are NF-014', …)
test('an issuer missing from the map is NF-016 and no network request is made', …)      // assert the JWKS server saw 0 requests
test('a token whose iss points at an attacker JWKS is NF-016', …)                        // attacker server valid-signs its own token
test('JWKS server down is unavailable, not invalid', …)
test('a token signed by a rotated-in second key verifies', …)
test('getIdentity returns the identity inside runWithIdentity and null outside', …)
test('concurrent runWithIdentity calls do not leak into each other', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): identity token verification with explicit issuer map"
```

### Task 11: `@next-federation/server` — `createIslandHandler`

**Files:**
- Create: `packages/server/src/{cors,handler,index}.ts`; `__tests__/{cors,handler}.spec.ts`
- Reference: `spike/proto/src/remote-handler.ts`

**Interfaces — Consumes:** Tasks 3, 9, 10. **Produces:**

```ts
export type RenderContext = { idPlaceholder: string; host: HostContext }
export type RenderIsland = (island: string, props: unknown, ctx: RenderContext) =>
  Promise<{ html: string; rscPayload: string; css: string[] }>
export type IslandHandlerOptions = {
  name: string; buildId: string; mode: ReactMode; reactVersion: string
  hosts: string[]                                  // allowed browser origins; '*' is rejected (NF-002)
  issuers?: IssuerMap
  islands: Record<string, { private?: boolean }>
  render: RenderIsland
  bootstrapUrl: () => string | Promise<string>     // absolute
  maxAge?: number                                  // default 60
  maxBodyBytes?: number                            // default 65536
  dev?: boolean                                    // enables NF-018 warnings
}
export function createIslandHandler(options: IslandHandlerOptions): (req: Request) => Promise<Response>
export function corsHeaders(req: Request, hosts: readonly string[]): Record<string, string>
```

`idPlaceholder` = `'nfid-' + fnv1a32(name + ':' + island + ':' + buildId) as 8 hex + '-'`. The handler runs `stripIslandHtml` on `render`'s HTML; in `dev`, each removed tag other than `link[rel=modulepreload]` logs `NF-018`. `render` runs inside `runWithIdentity(identityOrNull, …)`.

Response table (also goes into `docs/protocol/v1.md`). Every response carries `Vary: Origin, Authorization`; every response to an allowed `Origin` carries the CORS headers, **including errors**. Error bodies are `{"error":"NF-0xx"}`.

| Condition | Status | Cache-Control |
|---|---|---|
| `OPTIONS` | 204 | — |
| `GET /_nf/health` (any prefix) | 200 `ok` | no-store |
| `Origin` present and not in `hosts` | 403 `NF-022`, no CORS headers | no-store |
| path is not an island path | 404 | no-store |
| method not GET/POST | 405 | no-store |
| `Content-Length` or read body > `maxBodyBytes` | 413 | no-store |
| undecodable path/props/host context | 400 `NF-004` | no-store |
| island not in `islands` | 404 `NF-021` | no-store |
| token invalid, or private island without token | 401 `NF-014`/`NF-016` | no-store |
| JWKS unavailable | 503 `NF-015`, `Retry-After: 5` | no-store |
| `render` throws, or a css/bootstrap URL is not absolute | 500 (error logged, not echoed) | no-store |
| success, no token | 200 envelope | `public, max-age=<maxAge>` |
| success, token presented (public or private island) | 200 envelope | `private, no-store` |

- [ ] **Step 1: Failing tests** (stub `render`; verifier exercised with a real JWKS server as in Task 10)

```ts
test('serves a v1 envelope that parseEnvelope accepts', async () => {
  const env = parseEnvelope(await (await handler(get('/_nf/island/Panel?p=' + b64({ sku: 'A1' })))).json())
  expect(env).toMatchObject({ remote: 'a', buildId: 'v1', mode: 'production', bootstrap: 'https://r.example/b/v1/assets/i.js' })
  expect(env.idPlaceholder).toMatch(/^nfid-[0-9a-f]{8}-$/)
})
test('idPlaceholder does not depend on props', …)
test('render receives decoded props, host context and the placeholder', …)
test('html is stripped of scripts and links before it is sent', …)
test('dev mode logs NF-018 for a <title> but not for a modulepreload link', …)
test('public response is public, max-age=60; any token makes it private, no-store', …)
test('private island without a token is 401 and render is not called', …)
test('unknown island is 404 NF-021', …); test('own-property lookup: island "constructor" is 404', …)
test('disallowed Origin is 403 and gets no allow-origin header', …)
test('an error response to an allowed Origin still has CORS headers', …)        // 404 and 401 cases
test('preflight allows Authorization, Content-Type, X-NF-Action and max-age 600', …)
test('POST body over 65536 bytes is 413', …); test('malformed base64 props is 400 NF-004', …)
test('JWKS outage is 503 with Retry-After', …)
test('a throwing render is 500, no-store, and the message is not in the body', …)
test('hosts containing "*" is NF-002 at creation', …)
test('a build-pinned prefix /b/v1/_nf/island/Panel is served', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm exec rstest packages/server` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/server docs/protocol/v1.md
git commit -m "feat(server): framework-free island handler with cors, identity and cache headers"
```

### Task 12: `@next-federation/server/node` — Node listener, multi-build server, retention

**Files:**
- Create: `packages/server/src/node/{listener,retention,serve-builds,serve-one,cli,index}.ts`; `__tests__/{listener,retention,serve-builds}.spec.ts`; `docs/guides/self-hosted-skew.md`
- Modify: `packages/server/package.json` (`exports["./node"]`, `bin: { "nf-serve": "./dist/node/cli.js" }`)
- Reference: `spike/island-remote/serve-versions.ts`, `serve-one-build.ts`

**Interfaces — Produces:**

```ts
export function toNodeListener(handler: (req: Request) => Promise<Response>): import('node:http').RequestListener
export type BuildInfo = { buildId: string; builtAt: number }                 // from <dir>/<buildId>/nf-build.json
export type Retention = { maxBuilds: number; minAgeMs: number }              // defaults 3 and 86_400_000
export function planRetention(builds: BuildInfo[], now: number, retention: Retention, current?: string):
  { current: string; live: string[]; retired: string[] }
export function serveBuilds(opts: { dir: string; port: number; host?: string; current?: string; retention?: Partial<Retention> }):
  Promise<{ close(): Promise<void>; live: string[]; retired: string[]; current: string }>
// CLI: nf-serve --dir <dir> --port <n> [--host 127.0.0.1] [--current <buildId>] [--max-builds 3] [--min-age-hours 24]
```

Layout served: `<dir>/<buildId>/{client,rsc,ssr}` + `nf-build.json`. Routes: `/b/<build>/assets/*` static from that build's `client/` (`Cache-Control: public, max-age=31536000, immutable`, `Access-Control-Allow-Origin: *`, path-traversal safe); `/b/<build>/_nf/*` → that build's handler; `/_nf/*` → current build. **One child process per live build** (finding 10: plugin-rsc's server runtime keeps process-wide state), each forced to `NODE_ENV=production` (finding 9). A retired or unknown build → `410` `{"error":"NF-023"}` with `Access-Control-Allow-Origin: *`.

Retention policy (the decision for "retirement policy for old builds"): `current` = `--current` or newest `builtAt`. Newest-first, a build is **live** if it is current, or among the newest `maxBuilds`, or younger than `minAgeMs`. Everything else is retired and its process is not started. Evaluated at start (a deploy restarts `nf-serve`). `docs/guides/self-hosted-skew.md` states the operator rule: keep builds for at least `max(host island revalidate, longest expected open tab)`; deleting a retired build's folder is safe; Vercel deployments already behave this way.

- [ ] **Step 1: Failing tests**

```ts
// retention.spec.ts
const b = (id: string, hoursAgo: number) => ({ buildId: id, builtAt: NOW - hoursAgo * 3_600_000 })
test('keeps the newest maxBuilds', () =>
  expect(planRetention([b('v1', 90), b('v2', 60), b('v3', 40), b('v4', 30)], NOW, { maxBuilds: 2, minAgeMs: 0 }))
    .toEqual({ current: 'v4', live: ['v4', 'v3'], retired: ['v2', 'v1'] }))
test('never retires a build younger than minAgeMs', …)        // 5 builds within 24 h, maxBuilds 2 → all live
test('an explicit current is always live even if oldest', …)
test('no builds throws NF-002', …)
// listener.spec.ts
test('round-trips method, headers, body and status through a real http server', …)
test('a handler that throws yields 500, not a crashed process', …)
// serve-builds.spec.ts  (two tiny fake builds whose rsc/index.js default-exports a handler echoing its buildId)
test('routes /b/v1/_nf/* to v1 and /_nf/* to the current build', …)
test('serves pinned assets immutably and blocks path traversal', …)      // GET /b/v1/assets/../../rsc/index.js → 404
test('a retired build answers 410 NF-023', …)                            // Review Focus 5
test('each build runs in its own process', …)                           // handlers report distinct process.pid
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (child processes via `child_process.fork` of `serve-one`; use `fileURLToPath(import.meta.url)`, not `import.meta.dirname`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/server docs/guides
git commit -m "feat(server): node listener and multi-build server with retention policy"
```

### Task 13: `@next-federation/island` — bridge, `<Link>`, `getIdentity`, bootstrap runtime

**Files:**
- Create: `packages/island/` scaffold (peers `react`, `react-dom`; rstest `happy-dom`); `src/{bridge-context.tsx,link.tsx,index.client.ts,index.server.ts}`; `src/bootstrap/{create-bootstrap.tsx,flight-scope.ts,index.ts}`; `__tests__/{link,bootstrap,flight-scope,exports}.spec.tsx`
- Reference: `spike/island-remote/src/{bootstrap.tsx,island-bridge.ts,islands/Link.tsx}`

**Interfaces — Consumes:** Task 3 types; `getIdentity` (Task 10). **Produces:**

```ts
// '@next-federation/island'  — exports map: { "react-server": "./dist/index.server.js", "default": "./dist/index.client.js" }
export function Link(props: { href: string; prefetch?: boolean } & Omit<ComponentProps<'a'>, 'href'>): ReactElement   // 'use client'
export function useIslandBridge(): IslandBridge                                                                     // 'use client'
export function BridgeProvider(props: { value: IslandBridge; children: ReactNode }): ReactElement                   // 'use client'
export function serverBridge(host: HostContext): IslandBridge      // navigate/prefetch are no-ops; used during remote SSR
export function getIdentity(): IslandIdentity | null               // server build: Task 10's; client build: throws NF-002 "server-only"

// '@next-federation/island/bootstrap'  (browser; bundler-neutral: the flight client and reference loader are injected)
export type FlightScope = { require(id: string): Promise<unknown>; chunkLoad(id: string): Promise<void> }
export function registerFlightScope(key: string, scope: FlightScope): void     // globalThis.__nf_rsc__[key] = scope
export function createIslandBootstrap(deps: {
  scopeKey: string                 // the build's absolute base URL
  remote: string; buildId: string; mode: ReactMode
  loadClientReference(id: string): Promise<unknown>
  createFromReadableStream<T>(stream: ReadableStream<Uint8Array>, options: { callServer: (id: string, args: unknown[]) => Promise<unknown> }): PromiseLike<T>
}): IslandBootstrapModule
```

`Link`: for an `href` starting with a single `/`, renders `bridge.basePath + (bridge.locale ? '/' + bridge.locale : '') + href`; any other href (`http:`, `//`, `#`, `mailto:`) is rendered as-is and never intercepted. A plain primary click (no modifier, not `defaultPrevented`, no `target` other than `_self`, no `download`) calls `preventDefault()` then `bridge.navigate(fullHref)`. `mouseenter`/`focus` call `bridge.prefetch(fullHref)` unless `prefetch === false`. Default bridge (no provider): `navigate = location.assign`, `prefetch` no-op, `basePath ''`, `locale ''`.

`createIslandBootstrap().mountIsland`: throws `NFError('NF-010')` if `options.envelope.buildId !== buildId` or `.remote !== remote` (this replaces the spike's unimplemented client-reference-prefix safety net: a payload routed to the wrong bootstrap fails loudly); throws `NFError('NF-006')` if `options.envelope.mode !== mode`. Registers the flight scope once per module (`require` strips a `$$cache=` suffix and memoises per id). `hydrateRoot(container, <BridgeProvider><Island payload/></BridgeProvider>, { identifierPrefix, onUncaughtError, onCaughtError, onRecoverableError })`; the `Island` component type is defined once so `update` keeps client state; `update` = `startTransition(() => root.render(...))`; `destroy` = `root.unmount()`. `callServer` rejects with `NFError('NF-019')` in this release.

- [ ] **Step 1: Failing tests**

```ts
// link.spec.tsx
test('renders basePath and locale into the href', …)                 // bridge { basePath: '/base', locale: 'fr' }, href '/nav/two' → '/base/fr/nav/two'
test('a plain click calls navigate with the full href and prevents default', …)
test.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'])('%s-click is left to the browser', …)
test('target="_blank" and external hrefs are not intercepted', …)
test('hover prefetches once per href; prefetch={false} never does', …)
test('without a provider navigate falls back to location.assign', …)
// flight-scope.spec.ts
test('two keys hold independent scopes', …); test('registering does not touch any other global', …)   // only __nf_rsc__ added to globalThis
// bootstrap.spec.tsx  (fake createFromReadableStream resolving to <button> matching the container HTML)
test('hydrates the container with the given identifierPrefix', …)
test('update keeps client state', …)                                 // click a counter, update, count preserved
test('destroy empties the root', …)
test('an envelope from another build throws NF-010', …)
test('a development envelope in a production bootstrap throws NF-006', …)
test('onError receives uncaught errors with kind "uncaught"', …)
test('calling a server action rejects with NF-019', …)
// exports.spec.ts
test('index.client does not import node:async_hooks', () => expect(readFileSync('packages/island/dist/index.client.js','utf8')).not.toMatch(/async_hooks/))
test('link.js and bridge-context.js start with "use client"', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** `pnpm --filter @next-federation/island build && pnpm exec rstest packages/island` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/island
git commit -m "feat(island): link, navigation bridge, getIdentity and bundler-neutral bootstrap runtime"
```

### Task 14: `@next-federation/vite` — options, flight-client scoping, build-time checks

**Files:**
- Create: `packages/vite/` scaffold (peer `vite ^8.0.0`, `react-server-dom-webpack ^19.0.0`; dependency `@vitejs/plugin-rsc: 0.5.39` exact); `src/{options,scope-flight-client,checks}.ts`; `__tests__/{options,scope-flight-client,checks}.spec.ts`
- Reference: `spike/island-remote/vite.config.ts`

**Interfaces — Produces:**

```ts
export type IslandRemoteOptions = {
  name: string
  base: string                                        // absolute URL where this remote is served, e.g. 'https://shop.example.com/'
  islands: Record<string, string | { entry: string; private?: boolean }>
  hosts: string[]                                     // host origins allowed to embed (CORS + Origin check)
  issuers?: Record<string, string>                    // issuer → JWKS URL
  buildId?: string
  versioned?: boolean                                 // default: true for build, false for serve
  maxAge?: number
}
export type ResolvedOptions = {
  name: string; buildId: string; mode: ReactMode
  publicBase: string                                  // versioned ? `${base}b/${buildId}/` : base   (always ends with '/')
  scopeKey: string                                    // === publicBase
  outDir: string                                      // versioned ? `dist/${buildId}` : 'dist'
  islands: Record<string, { entry: string; private: boolean }>
  hosts: string[]; issuers: Record<string, string>; maxAge: number
}
export function resolveOptions(options: IslandRemoteOptions,
  ctx: { command: 'serve' | 'build'; env: Record<string, string | undefined>; now: number }): ResolvedOptions
export function scopeFlightClient(code: string, scopeKey: string): string
export const FLIGHT_CLIENT_ID: RegExp                 // /react-server-dom-webpack-client\.browser/
export function optimizerCacheDir(name: string, scopeKey: string): string   // `node_modules/.vite-nf-${name}-${sha1(scopeKey).slice(0, 8)}`
export function assertPluginRscVersion(version: string, env: Record<string, string | undefined>): void
//  NF-025 unless version === '0.5.39'; with env.NF_ALLOW_PLUGIN_RSC === '1' it logs NF-025 as a warning instead (CI canary job only)
export function findServerActions(code: string): boolean                    // true for a file- or function-level 'use server' directive
```

`resolveOptions`: `NF-020` if `base` is not an absolute http(s) URL; `NF-002` for bad names, empty `islands`, `hosts` containing `*` or a non-origin. `buildId` = option → `env.NF_BUILD_ID` → `'dev'` for serve → `ctx.now.toString(36)` for build; must match `/^[A-Za-z0-9._-]+$/`. `mode` = `'development'` for serve, `'production'` for build.

`scopeFlightClient` (finding 1; exact replacements, in this order, with `SLOT = 'globalThis.__nf_rsc__[' + JSON.stringify(scopeKey) + ']'`): `__vite_rsc_require__` → `SLOT.require`; `__webpack_require__.u` → `({}).u`; `__webpack_require__` → `SLOT.require`; `__webpack_chunk_load__` → `SLOT.chunkLoad`.

- [ ] **Step 1: Failing tests**

```ts
test('unversioned serve: publicBase is base, buildId "dev", mode development', …)
test('versioned build: publicBase and outDir carry the buildId', () => {
  const r = resolveOptions({ ...opts, base: 'https://r.example', buildId: 'v2' }, { command: 'build', env: {}, now: 0 })
  expect(r.publicBase).toBe('https://r.example/b/v2/'); expect(r.outDir).toBe('dist/v2'); expect(r.mode).toBe('production')
})
test('NF_BUILD_ID env is used when no option is given', …)
test('relative base is NF-020', …); test('hosts ["*"] is NF-002', …); test('buildId with a slash is NF-002', …)
test('string and object island entries normalise to { entry, private }', …)
test('scopes every flight-client global to the build key', () => {
  const out = scopeFlightClient('__vite_rsc_require__(a);__webpack_require__.u(b);__webpack_require__(c);__webpack_chunk_load__(d)', 'https://r.example/b/v2/')
  expect(out).toBe('globalThis.__nf_rsc__["https://r.example/b/v2/"].require(a);({}).u(b);globalThis.__nf_rsc__["https://r.example/b/v2/"].require(c);globalThis.__nf_rsc__["https://r.example/b/v2/"].chunkLoad(d)')
})
test('two builds of one remote get different scope keys and cache dirs', …)       // finding 14
test('plugin-rsc 0.5.40 is NF-025; with NF_ALLOW_PLUGIN_RSC=1 it only warns', …)
test.each([`'use server'\nexport async function a(){}`, `export async function a(){ "use server" }`])('detects server actions', …)
test('a string literal "use server" inside an expression is not a directive', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm exec rstest packages/vite` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/vite
git commit -m "feat(vite): remote options, per-build flight-client scoping and build checks"
```

### Task 15: `@next-federation/vite` plugin + `island-remote` fixture + e2e harness

**Files:**
- Create: `packages/vite/src/index.ts`; `packages/vite/src/plugin-rsc/{plugin.ts,entry.rsc.tsx,entry.ssr.tsx,entry.client.tsx,css.ts}`; `packages/vite/__tests__/build.spec.ts`
- Move: `git mv spike/island-remote test/fixtures/island-remote`; `git mv spike/e2e test/e2e`
- Delete in the fixture: `src/{bootstrap.tsx,entry.rsc.tsx,entry.ssr.tsx,island-bridge.ts,actions.ts}`, `src/islands/{Link,Form,AddToCart}.tsx`, `serve-versions.ts`, `serve-one-build.ts`, every `export const islandCss`; in `test/e2e`: `actions.spec.ts` (returns in Phase 3)
- Modify: fixture `vite.config.ts`, `package.json`, island files; `test/e2e/{playwright.config.ts,package.json,protocol-endpoint.spec.ts,fixtures/jwks-server.ts}`
- Create: `test/e2e/servers.ts`, `test/e2e/fixtures/test-signing-key.json` (test-only ES256 private JWK from `generateSigningKey('test-1')`, passed to hosts as `NF_SIGNING_KEY`), `test/e2e/fixtures/fake-remote.ts` (port 4102; only `/_nf/health` for now, cases are added in Tasks 18 and 24); root scripts `e2e:dev`, `e2e:dev:webpack`, `e2e:prod`, `e2e:prod:webpack`, `e2e:skew`, `e2e` (runs all five in order)

**Interfaces — Consumes:** Tasks 11–14. **Produces:**

```ts
// '@next-federation/vite'
export function nextFederationIslands(options: IslandRemoteOptions): import('vite').Plugin[]
```

Built output (`<outDir>/{client,ssr,rsc}` + `<outDir>/nf-build.json` = `{ name, buildId, builtAt, base: publicBase }`): `rsc/index.js` default-exports `(req: Request) => Promise<Response>` (Task 12 runs it); the client entry exports `mountIsland`.

e2e harness contract (`test/e2e/servers.ts`): `NF_MODE=dev|prod` (default `dev`), `NF_BUNDLER=turbopack|webpack`, `NF_SUITE=default|skew`. Ports: fake issuer `3999`; remote `a` `4100`, remote `b` `4101`, fake remote `4102`; host-app `3100`, host-app + `cacheComponents` `3102`; host-pages `3101`, host-pages + `basePath=/base` `3103`; host-spa `4200`. Hosts are reached as `localhost`, remotes as `127.0.0.1` (different site). Remote commands: dev = `vite --port <p>`; prod = `vite build && nf-serve --dir dist --port <p>` (so every prod run uses versioned, build-pinned paths); skew (remote `a` only) = build `v1` then `v2`, then `nf-serve`. Apps whose folder does not exist yet are skipped, as in the spike config. `reuseExistingServer: false`. `next build` output is teed to `test/e2e/.logs/<app>-<port>.build.log`.

What the plugin does (each line is a requirement; all plugin-rsc contact is in `src/plugin-rsc/`):
1. Calls `assertPluginRscVersion(installedVersion, process.env)`, then returns `[...rsc({ entries: { rsc, ssr, client }, rscCssTransform: false }), scopePlugin, checksPlugin, configPlugin]`. The three entries are this package's own `plugin-rsc/entry.*.tsx` files.
2. `config`: `base = publicBase`; `cacheDir = optimizerCacheDir(...)` (finding 14); `oxc.jsx = { runtime: 'automatic', importSource: 'react' }`; client `optimizeDeps.rolldownOptions.plugins` gets the flight-client scope transform (dev pre-bundle); client `build.rollupOptions.preserveEntrySignatures = 'exports-only'` (finding 7); `environments.{client,ssr,rsc}.build.outDir = <outDir>/<env>`; `environments.{rsc,ssr}.resolve.noExternal` includes `/^@next-federation\//` (so the `react-server` export condition and `'use client'` in `@next-federation/island` are honoured); dev `server.cors.origin = hosts`.
3. `configResolved`: throws `NF-002` if a plugin named `vite:react-refresh` or `vite:react-babel` is present (finding 5: no Fast Refresh in exposed modules; README documents "no Fast Refresh for islands inside a host" as a known DX gap).
4. Scope transform for the `client` environment on `FLIGHT_CLIENT_ID` using `scopeFlightClient` (build pipeline + optimizer).
5. `virtual:next-federation/config` → the `ResolvedOptions` as JSON. `virtual:next-federation/islands` → `{ [name]: { load: () => import(entry), private } }`.
6. RSC-environment transform on each island entry module: appends exactly one `export const __nf_css = () => import.meta.viteRsc.loadCss()` (finding 8: one `loadCss()` per module). `css.ts` resolves that export to absolute stylesheet URLs against `publicBase` (the spike's `collectHrefs`).
7. Checks plugin: any module in the build with `findServerActions(code) === true` fails with `NF-019` (dev and build).
8. `entry.rsc.tsx`: builds `createIslandHandler({ …config, mode: process.env.NODE_ENV === 'production' ? 'production' : 'development', reactVersion, render, bootstrapUrl, dev: import.meta.env.DEV })`. `render` = RSC stream teed to (a) payload text and (b) `entry.ssr` HTML, with `identifierPrefix: ctx.idPlaceholder` and the tree wrapped in `<BridgeProvider value={serverBridge(ctx.host)}>` on the SSR side. Buffered (design §13).
9. `entry.client.tsx`: `export const { mountIsland } = createIslandBootstrap({ scopeKey: publicBase, remote, buildId, mode: import.meta.env.DEV ? 'development' : 'production', loadClientReference, createFromReadableStream })`. In dev `bootstrapUrl` must point at this module directly, never at plugin-rsc's dev wrapper (it installs Fast Refresh globals); serve it through a `virtual:next-federation/bootstrap` id.
10. `closeBundle`: writes `nf-build.json`.

- [ ] **Step 1: Port the fixture.** `vite.config.ts` becomes:

```ts
const PORT = Number(process.env.PORT ?? 4100)
const HOSTS = [3100, 3101, 3102, 3103, 4200].map((p) => `http://localhost:${p}`)
export default defineConfig({
  plugins: nextFederationIslands({
    name: process.env.NF_REMOTE ?? 'a',
    base: `http://127.0.0.1:${PORT}/`,
    hosts: HOSTS,
    issuers: Object.fromEntries([
      ...[3100, 3102, 3101].map((p) => [`http://localhost:${p}`, `http://localhost:${p}/api/next-federation/jwks`]),
      ['http://localhost:3103/base', 'http://localhost:3103/base/api/next-federation/jwks'],
      ['http://localhost:3999', 'http://localhost:3999/jwks'],
    ]),
    islands: {
      ProductPanel: './src/islands/ProductPanel.tsx', Banner: './src/islands/Banner.tsx', Links: './src/islands/Links.tsx',
      Slow: './src/islands/Slow.tsx', MyOrders: { entry: './src/islands/MyOrders.tsx', private: true },
    },
  }),
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
```

`Links.tsx` uses `Link` from `@next-federation/island` with `href={`/nav/${other}`}` and no `basePath`/`locale` props. `MyOrders.tsx` uses `getIdentity` from `@next-federation/island`. `ProductPanel.tsx` keeps `Counter` and its CSS, drops `AddToCart`.

- [ ] **Step 2: Write the failing build test** `packages/vite/__tests__/build.spec.ts` (`testTimeout: 180000`; runs Vite's `createBuilder().buildApp()` on the fixture into a temp `outDir`, `NF_BUILD_ID=t1`)

```ts
test('writes nf-build.json with the pinned base', () => expect(info).toMatchObject({ name: 'a', buildId: 't1', base: 'http://127.0.0.1:4100/b/t1/' }))
test('the client entry keeps its mountIsland export', …)                    // finding 7: regex /export\s*\{[^}]*mountIsland/ on the entry chunk
test('client chunks reference the scoped registry and no plugin-rsc page globals', () => {
  expect(clientJs).toContain('__nf_rsc__["http://127.0.0.1:4100/b/t1/"]')
  expect(clientJs).not.toMatch(/__vite_rsc_require__|__viteRscCallServer|__vite_rsc_client_require__/)
})
test('the built handler serves an envelope with css for every island that imports css', async () => {
  const handler = (await import(pathToFileURL(join(out, 'rsc/index.js')).href)).default
  const env = parseEnvelope(await (await handler(new Request('http://127.0.0.1:4100/_nf/island/ProductPanel?p=' + b64({ sku: 'A1' })))).json())
  expect(env.mode).toBe('production'); expect(env.css[0]).toMatch(/^http:\/\/127\.0\.0\.1:4100\/b\/t1\/assets\/.+\.css$/)
  expect(env.bootstrap).toMatch(/^http:\/\/127\.0\.0\.1:4100\/b\/t1\/assets\/.+\.js$/)
  expect(env.html).not.toMatch(/<script|<link/); expect(env.html).toContain('nf-product-panel')
})
test('a module with "use server" fails the build with NF-019', …)           // temp fixture file
test('adding @vitejs/plugin-react fails with NF-002', …)
```

- [ ] **Step 3: Run** `pnpm exec rstest packages/vite/__tests__/build.spec.ts` → FAIL. **Step 4: Implement** the plugin and entries. **Step 5: Run** → PASS.

- [ ] **Step 6: Port `protocol-endpoint.spec.ts`** to the new envelope (`remote`, `mode`, `idPlaceholder`; issuer map; `fixtures/jwks-server.ts` mints tokens at `/mint?aud=&sub=&ttl=`), keeping all eight spike tests and adding:

```ts
test('envelope mode matches how the remote was started', …)                     // NF_MODE=dev → development, prod → production
test('an error response to an allowed origin carries CORS headers', …)
test('the island HTML contains no <script> or <link>', …)                       // prod is where React emits them (finding 6)
```

- [ ] **Step 7: Run the endpoint suite in both remote modes** (only the issuer and remotes exist yet; hosts are skipped). The user runs these when ports 3999/4100/4101 are free:

```bash
pnpm e2e:dev -- protocol-endpoint && pnpm e2e:prod -- protocol-endpoint
```

Expected: 11 passed in each run.

- [ ] **Step 8: Commit**

```bash
git add -A packages/vite test spike package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(vite): island remote plugin wrapping plugin-rsc; port remote fixture and e2e harness"
```

### Task 16: `@next-federation/react` — `IslandMount` lifecycle

**Files:**
- Create: `packages/react/src/{island-mount.tsx,island-registry.ts,events.ts}`; `__tests__/{island-mount,island-registry}.spec.tsx`
- Modify: `packages/react/src/index.ts`, `package.json` (dependency `@next-federation/protocol`)
- Reference: `spike/proto/src/island-mount.tsx` (keep its WeakMap/sweep/deferred-cleanup algorithm)

**Interfaces — Consumes:** Task 3. **Produces:**

```ts
'use client'
export const ISLAND_EVENT = 'nf:island'
export type IslandClientEvent =
  | { type: 'island:hydrate'; remote: string; buildId: string; ms: number }
  | { type: 'island:error'; remote: string; buildId: string; kind: IslandErrorKind | 'bootstrap'; code: NFErrorCode; error: unknown }
export type IslandMountProps = {
  envelope: IslandEnvelope
  bridge?: Partial<IslandBridge>
  token?: { endpoint: string; identityKey: string | null } | null     // wired in Task 17
  errorFallback?: ReactNode
  onEvent?: (event: IslandClientEvent) => void
  loadBootstrap?: (url: string) => Promise<IslandBootstrapModule>     // test seam
}
export function IslandMount(props: IslandMountProps): ReactElement
export function getLiveIslandCount(): number
```

Rendered container: `<div data-nf-root="" data-nf-remote data-nf-build data-nf-state suppressHydrationWarning dangerouslySetInnerHTML>`; `data-nf-state` ∈ `booting | live | inert | failed`. Default `loadBootstrap` is `import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url)`.

Lifecycle rules (design §6, as amended by the spike):
1. The mount id is the host's `useId()`. HTML and every payload go through `applyIdPrefix(envelope, mountId)`; the HTML is computed once (`useState` initialiser) and never rewritten by later renders.
2. Roots are keyed to the container node in a module-level `WeakMap`, never to the effect. Effect cleanup never unmounts synchronously: it schedules a `setTimeout(0)` check and destroys only if the node is disconnected (StrictMode and hidden `<Activity>` safe). Each effect run first sweeps entries whose node left the document.
3. First effect for a node: load the bootstrap, then `mountIsland` with the envelope **the HTML came from**; if a newer envelope arrived meanwhile, `update` right after. If the node was disconnected or re-keyed while loading, do nothing.
4. New envelope, same `buildId` and `bootstrap`: `handle.update({ rscPayload })` only. No DOM write, no remote fetch.
5. New `buildId` or `bootstrap`: destroy, set `innerHTML` to the new prefixed HTML, state `booting`, bootstrap again.
6. Bootstrap import rejects, or `mountIsland` throws: state `inert`, server HTML kept, event `{ kind: 'bootstrap', code }` where `code` is the thrown `NFError`'s code or `NF-011`.
7. `onError(_, 'uncaught')`: destroy, state `failed`, render `errorFallback` in place of the container (nothing if absent), event code `NF-012`. `caught`/`recoverable`: event only.
8. Every event goes to `onEvent` and is dispatched on the container as a bubbling `CustomEvent(ISLAND_EVENT, { detail })` (the only channel that works across the App Router server/client boundary). Errors are also logged through `logger.error`.
9. No writes to `globalThis`. `getLiveIslandCount()` replaces the spike's debug global.

- [ ] **Step 1: Failing tests** (happy-dom, `act`, fake bootstrap module recording `mountIsland`/`update`/`destroy` calls)

```ts
test('server render contains the prefixed html and booting state', …)            // renderToString; no raw idPlaceholder left
test('hydrates once with the original envelope, even under StrictMode', …)       // mountIsland called exactly once
test('a new envelope from the same build calls update and does not touch the DOM', …)
test('an envelope that arrives while the bootstrap loads is applied right after hydrate', …)
test('a new buildId destroys, rewrites html and bootstraps again', …)
test('a new bootstrap URL with the same buildId also re-bootstraps', …)
test('unmounting destroys the root on the next tick; live count returns to 0', …)
test('effect cleanup with the node still connected keeps the root', …)           // toggle an unrelated dep to re-run the effect
test('a key change (container swap) destroys the old root and mounts the new node', …)
test('unmount while the bootstrap is loading never calls mountIsland', …)
test('10 rapid mount/unmount toggles leave exactly one live root', …)
test('two mounts of one envelope pass different identifierPrefix values', …)     // Review Focus 1
test('a rejected bootstrap import leaves the html, marks inert and emits NF-011', …)   // Review Focus 5
test('mountIsland throwing NF-006 marks inert and reports NF-006', …)
test('an uncaught island error renders errorFallback and emits NF-012', …)
test('events are dispatched as a bubbling nf:island CustomEvent', …)
test('bridge defaults are merged under a partial bridge', …)                      // basePath '', locale '', navigate falls back to location.assign
test('the module adds no property to globalThis', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** `pnpm exec rstest packages/react` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/react
git commit -m "feat(react): island mount with node-keyed lifecycle, re-bootstrap and error states"
```

### Task 17: `@next-federation/react` — browser token client

**Files:**
- Create: `packages/react/src/token-client.ts`; `__tests__/token-client.spec.ts`
- Modify: `packages/react/src/island-mount.tsx` (pass `getToken` built from `props.token`), `src/index.ts`

**Interfaces — Produces:**

```ts
export type TokenClient = { getToken(): Promise<string | null>; invalidate(): void }
export function createTokenClient(opts: { endpoint: string; identityKey: string | null;
  fetch?: typeof fetch; now?: () => number }): TokenClient
export function clearIslandTokens(): void          // hosts call this on sign-out
```

Endpoint contract (Task 21 implements it): `POST <endpoint>` with `credentials: 'same-origin'` → `200 { token: string; expiresAt: number; identityKey: string }` or `401`. Rules: tokens live in a module-level `Map` keyed by endpoint, **memory only**. A cached token is used only if `expiresAt - 30 > now` **and** (`opts.identityKey === null` or it equals the cached `identityKey`). A `401` or network failure clears the entry and returns `null`. `invalidate()` clears the entry (Phase 3 calls it when a remote answers 401, then retries once). Concurrent `getToken()` calls share one request. Nothing is fetched until `getToken()` is first called (Phase 2 has no caller yet besides tests; Phase 3's `callServer` is the first).

- [ ] **Step 1: Failing tests** (fake fetch and clock)

```ts
test('fetches lazily, once, with POST and same-origin credentials', …)
test('reuses the token until 30 s before expiry, then refreshes', …)
test('concurrent calls share one request', …)
test('a different identityKey drops the cached token and refetches', …)          // Review Focus 4: user switched
test('a 401 clears the cache and returns null; the next call refetches', …)      // Review Focus 4: signed out
test('invalidate() forces a refetch', …)
test('clearIslandTokens() empties every endpoint', …)
test('the token is never written to localStorage, sessionStorage or document.cookie', …)
test('IslandMount passes a getToken that resolves null when no token prop is given', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/react
git commit -m "feat(react): session-bound browser token client"
```

### Task 18: `host-spa` fixture + lifecycle and skew e2e

**Files:**
- Move: `git mv spike/spa test/fixtures/host-spa`
- Delete in the fixture: `src/CartButton.tsx`, the Module Federation plugin and config in `vite.config.ts`
- Modify: `src/main.tsx` (wrap the root in `<StrictMode>`), `src/routes/{Islands,Inject,Skew}.tsx`, `package.json`; `test/e2e/{lifecycle,skew,spa}.spec.ts`
- Create: `src/routes/{Inert,Retired}.tsx`, `src/lib/islands.ts`
- Modify: `test/e2e/fixtures/fake-remote.ts` (add the `BrokenBootstrap` case: valid envelope, own-origin bootstrap URL that returns 404), `test/e2e/servers.ts` (for `NF_SUITE=skew`, a second `nf-serve` of remote `a` on port `4103` with `--max-builds 1 --min-age-hours 0`, so `v1` is retired there)

**Interfaces — Consumes:** `fetchIsland`, `defineFederation` (browser use of `core`), `IslandMount`, `getLiveIslandCount`. The fixture renders `<output data-testid="live-roots">{getLiveIslandCount()}</output>` refreshed on the `nf:island` event and a 100 ms interval, replacing the spike's `window.__nf_liveRoots`.

- [ ] **Step 1: Port the fixture.** `src/lib/islands.ts` exports `federation = defineFederation({ remotes: { a: { origin: 'http://127.0.0.1:4100' }, b: { origin: 'http://127.0.0.1:4101' }, fake: { origin: 'http://127.0.0.1:4102' } } })`. `/skew?build=v1` stands in for an envelope cached before a redeploy: it calls `fetchIsland({ ...federation.target('a'), origin: 'http://127.0.0.1:4100/b/v1' }, …)` (the build-pinned handler path); without the query it fetches from the current build. `/inert` mounts the fake remote's `BrokenBootstrap` island (valid envelope whose bootstrap URL returns 404).

- [ ] **Step 2: Port and extend the specs** — keep every spike test in `lifecycle.spec.ts` and `skew.spec.ts` except assertions on Server Actions (`Add A1`, `/_nf/action`), and add:

```ts
// lifecycle.spec.ts
test('no plugin-rsc page globals and exactly one library global', async ({ page }) => {
  await page.goto('http://localhost:4200/islands')
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
  expect(await page.evaluate(() => Object.keys(window).filter((k) => /vite_rsc|viteRsc|^__nf/.test(k)))).toEqual(['__nf_rsc__'])
})
test('StrictMode: each island is hydrated exactly once', …)                       // live-roots output is 2, no console errors
test('a bootstrap that fails to load leaves the server html visible and inert', async ({ page }) => {
  await page.goto('http://localhost:4200/inert')
  await expect(page.locator('[data-nf-state="inert"]')).toHaveCount(1)
  await expect(page.getByTestId('broken-html')).toBeVisible()
})
// skew.spec.ts (NF_SUITE=skew)
test('a v1 island keeps working after v2 is deployed: assets and state stay on v1', …)
test('a new buildId re-bootstraps on v2', …)
test('v1 and v2 islands of one remote are live together', …)
test('a retired build answers 410 and the host shows its fallback', …)            // /retired fetches http://127.0.0.1:4103/b/v1 → 410 → errorFallback
```

- [ ] **Step 3: Run** (user, ports free): `pnpm e2e:dev -- lifecycle spa && pnpm e2e:prod -- lifecycle spa && pnpm e2e:skew`. Expected: all passed; `skew` 4 passed.
- [ ] **Step 4: Commit**

```bash
git add -A test spike
git commit -m "test: port spa host fixture; lifecycle, strict mode, inert and skew e2e"
```

### Task 18A: PROVING GATE — shared React across island remotes (`nf-islands` scope)

This task proves or disproves island React sharing **in the fixtures only**, before any library code depends on it. Its outcome decides whether Task 18B runs.

**Files:**
- Create: `test/fixtures/island-remote/share-proof.ts` (fixture-local Vite plugin, throwaway), `test/fixtures/island-remote-old-react/` (`package.json` pinning the previous published stable React 19 patch for `react`, `react-dom`, `react-server-dom-webpack`; `vite.config.ts` that sets `root` to `../island-remote` and remote name `c`, port `4104`), `test/fixtures/host-spa/src/routes/Shared.tsx`, `test/e2e/sharing.spec.ts`, `docs/spike/island-sharing-proof.md` (result record)
- Modify: `test/fixtures/island-remote/vite.config.ts` (apply `share-proof` when `NF_SHARE=1`), `test/e2e/servers.ts` (remote `c` on `4104`; `NF_SHARE=1` passes through), `test/fixtures/host-spa/src/lib/islands.ts` (remote `c`)

**Interfaces — Consumes:** Tasks 15, 16, 18. **Produces:** a written verdict (`PASS`/`FAIL` + chosen mechanism) in `docs/spike/island-sharing-proof.md`, and the e2e spec that Task 18B must keep green.

Mechanism to try, in this order (stop at the first that passes all criteria):
1. **`@module-federation/vite` 1.24.0 on the `client` environment only**, `shareScope: 'nf-islands'`, `shared: { react, 'react-dom', 'react-dom/client', 'react/jsx-runtime' }` each `{ singleton: true, strictVersion: true, requiredVersion: <exact installed version> }`, no exposes, no remotes.
2. **Hand-rolled shim on `@module-federation/runtime` 2.9.3**: the client build resolves those four specifiers to virtual modules that `await` `instance.loadShare(name)` from a runtime instance created in the bootstrap with `shareScope 'nf-islands'` and the bundled copy registered as the fallback provider (`strictVersion`, exact version).

In both, `react-server-dom-webpack/client.browser` stays bundled per remote, still passes through `scopeFlightClient`, and its `react`/`react-dom` imports resolve to the shared modules.

Pass criteria (all required, **production remotes**, Chromium, SPA host `/shared`):

- [ ] **Step 1: Write the failing e2e** `test/e2e/sharing.spec.ts` (skipped unless `NF_SHARE=1` and `NF_MODE=prod`)

```ts
const reactChunks = (urls: string[]) => urls.filter((u) => /react(-dom)?[.-][\w-]*\.js$/.test(new URL(u).pathname))
test('two remotes on the same React download React exactly once', async ({ page }) => {
  const js: string[] = []
  page.on('response', (r) => r.url().endsWith('.js') && js.push(r.url()))
  await page.goto('http://localhost:4200/shared?remotes=a,b')
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
  const origins = new Set(reactChunks(js).map((u) => new URL(u).origin))
  expect(origins.size).toBe(1)                                   // React and ReactDOM came from one remote only
  expect(await page.evaluate(() => (window as any).__nfProofReactCopies)).toBe(1)   // fixture-only probe set by share-proof.ts
})
test('both islands keep independent state and their own flight scope', …)        // counters independent; __nf_rsc__ has two keys
test('a remote on a different React version works with its own copy', async ({ page }) => {
  await page.goto('http://localhost:4200/shared?remotes=a,c')
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
  expect(await page.evaluate(() => (window as any).__nfProofReactCopies)).toBe(2)
  // no "Invalid hook call", no React error 504, no console error
})
test('load order does not matter: c first, then a and b', …)                     // a and b still share; c separate
test('two builds of one remote (v1 + v2) still isolate their flight clients while sharing React', …)   // NF_SUITE=skew
```

- [ ] **Step 2: Run** `NF_SHARE=1 pnpm e2e:prod -- sharing` → FAIL (no sharing yet; copies = 2).
- [ ] **Step 3: Implement mechanism 1 in `share-proof.ts`; if a criterion fails, implement mechanism 2.** Record what broke.
- [ ] **Step 4: Run the gate** (user, ports free):

```bash
NF_SHARE=1 pnpm e2e:prod -- sharing && NF_SHARE=1 pnpm e2e:prod:webpack -- sharing
NF_SHARE=1 pnpm e2e:prod -- lifecycle spa && NF_SHARE=1 pnpm e2e:skew      # existing collision and skew tests must still pass
pnpm e2e:dev -- lifecycle spa                                              # dev remotes unaffected (no sharing in dev)
NF_SHARE=1 NF_MEASURE=1 pnpm e2e:prod -- measure
```

Expected: all green. Measurement expectations, against the spike baseline of **~76 KB gzip (242 KB raw, 3 files) per distinct remote**: first remote on a page ≤ 84 KB gzip (baseline + at most 8 KB for the share runtime); each further remote on the same React ≤ 30 KB gzip; a mismatched-version remote ≤ 84 KB. Record the numbers in `docs/spike/island-sharing-proof.md`.

- [ ] **Step 5: Decide and record.**
  - **PASS** (all tests green and the second same-React remote saves ≥ 40 KB gzip): write the verdict and mechanism; continue with Task 18B.
  - **FAIL** (either mechanism breaks a criterion, breaks the collision/skew suites, or saves < 40 KB): write the verdict and the reason; **skip Task 18B**; delete `share-proof.ts` and the `NF_SHARE` wiring; keep `island-remote-old-react` out of the workspace. Islands then ship **without sharing — each remote bundles its own React, exactly the spike behaviour (~76 KB gzip per remote)** — and island React sharing moves to the after-v1.0 list (design §3 already lists "React dedup across remotes" there). Tasks 19–25 do not depend on sharing and proceed unchanged; drop the sharing lines from Tasks 23, 24 and 25.

- [ ] **Step 6: Commit**

```bash
git add -A test docs/spike/island-sharing-proof.md
git commit -m "test: proving gate for shared react across island remotes"
```

### Task 18B: Island React sharing in `@next-federation/vite`, `island/bootstrap` and `react` (only if 18A passed)

**Files:**
- Create: `packages/vite/src/share.ts`; `packages/island/src/bootstrap/share-scope.ts`; `packages/react/src/provide-host-react.ts` (export `"./share"`); `packages/vite/__tests__/share.spec.ts`, `packages/island/__tests__/share-scope.spec.ts`, `packages/react/__tests__/provide-host-react.spec.ts`
- Modify: `packages/vite/src/{options.ts,index.ts}`, `packages/vite/src/plugin-rsc/entry.client.tsx`, `packages/vite/__tests__/build.spec.ts`; `test/fixtures/island-remote/vite.config.ts` (drop `share-proof.ts`, use the option); `test/fixtures/host-spa` (`/shared?host=1` calls `provideHostReact()`); `test/e2e/sharing.spec.ts` (drop the fixture probe; assert through network only)
- Delete: `test/fixtures/island-remote/share-proof.ts`

**Interfaces — Consumes:** Task 18A's mechanism; Tasks 13–15. **Produces:**

```ts
// IslandRemoteOptions gains (packages/vite/src/options.ts)
share?: boolean | { libs?: string[] }      // default true for build, always false for serve.
                                           // libs: extra bare specifiers shared as exact-version singletons (e.g. a design-system package)
// ResolvedOptions gains
share: null | { scope: 'nf-islands'; libs: Array<{ name: string; version: string }> }   // always includes react, react-dom,
                                           // react-dom/client, react/jsx-runtime at the remote's installed exact version
// packages/vite/src/share.ts
export const ISLAND_SHARE_SCOPE = 'nf-islands'
export function resolveShared(libs: string[], readVersion: (pkg: string) => string): Array<{ name: string; version: string }>
//  NF-002 if a lib is react-server-dom-webpack (never shareable) or its version cannot be read
// '@next-federation/island/bootstrap'
export function initIslandShareScope(shared: Array<{ name: string; version: string; get: () => Promise<unknown> }>): Promise<void>
//  registers this build's copies as providers in scope 'nf-islands' and resolves each lib to the already-registered
//  exact-version copy if one exists, else its own. Never throws: any failure falls back to the bundled copy and logs once.
// '@next-federation/react/share'  ('use client')
export function provideHostReact(): boolean
//  Registers the host's react, react-dom, react-dom/client, react/jsx-runtime into 'nf-islands'. Returns false and does
//  nothing when React.version contains '-' (canary/experimental: every App Router host) or NODE_ENV !== 'production'.
```

Rules: exact-version match only (`19.3.1` shares with `19.3.1`, never with `19.3.0` or a canary); the envelope's `reactVersion` is the version the remote shares under. The flight client is excluded from sharing by construction and still rewritten by `scopeFlightClient`. `provideHostReact()` must run before the first island bootstraps to have an effect (call it at module scope of the app entry); calling it later is harmless. The MF runtime is a dependency of `@next-federation/island` (browser bootstrap) and `@next-federation/react/share` only; `core` does not gain it until Phase 4.

- [ ] **Step 1: Failing unit tests**

```ts
// share.spec.ts
test('always shares the four React entries at the installed exact version', …)
test('extra libs are added with their exact versions', …)
test('react-server-dom-webpack in libs is NF-002', …)
test('serve never shares; build shares by default; share: false disables', …)        // resolveOptions
// share-scope.spec.ts (fake MF runtime instance)
test('the first remote provides; a second remote on the same version consumes it', …)
test('a different version is not consumed: the remote uses its own copy', …)
test('a share-scope failure falls back to the bundled copy and never rejects', …)
// provide-host-react.spec.ts
test('a canary React version returns false and registers nothing', …)                // version '19.3.0-canary-df6aa4ec-20261112'
test('development mode returns false', …)
test('stable production React registers four entries under nf-islands', …)
// build.spec.ts additions
test('with sharing on, the flight client chunk is still scoped per build and is not in the share manifest', …)
test('share: false produces the same output shape as before sharing existed', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with the mechanism recorded in `docs/spike/island-sharing-proof.md`. **Step 4:** `pnpm build && pnpm exec rstest packages/{vite,island,react}` → PASS.
- [ ] **Step 5: e2e** — extend `sharing.spec.ts`:

```ts
test('a host that provides its React: islands download no React at all', async ({ page }) => {    // SPA, /shared?host=1&remotes=a,b
  …; expect(reactChunks(js).filter((u) => !u.startsWith('http://localhost:4200'))).toEqual([])
})
test('share: false remotes behave exactly like the spike (one React per remote)', …)
```

Run (user): `pnpm e2e:prod -- sharing lifecycle spa && pnpm e2e:prod:webpack -- sharing && pnpm e2e:skew`. Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A packages test
git commit -m "feat: share react across island remotes in the nf-islands scope"
```

### Task 19: `@next-federation/next` — `withNextFederation` and the cache-model gate

**Files:**
- Create: `packages/next/` scaffold (peers `next >=16.0.0 <17`, `react ^19.0.0`); `src/config.ts`; `src/server/{island-cache.legacy.ts,island-cache.cc.ts,assert-wrapped.ts}`; `__tests__/{config,island-cache}.spec.ts`
- Move: `git mv spike/host-app test/fixtures/host-app` (in this task only `next.config.ts`, `package.json` and a probe page change; the rest is ported in Task 22)
- Create: `test/fixtures/host-app/app/probe/page.tsx`

**Interfaces — Produces:**

```ts
// '@next-federation/next/config'
export function withNextFederation<T extends NextConfig | ((phase: string, ctx: unknown) => NextConfig | Promise<NextConfig>)>(config: T): T
// package exports: './island-cache' (→ legacy), './island-cache/legacy', './island-cache/cache-components'
// both island-cache modules export:
export function getPublicEnvelope(target: IslandTarget, island: string, propsJson: string, hostJson: string, revalidate: number): Promise<IslandResult>
// src/server/assert-wrapped.ts
export function cacheModel(): 'legacy' | 'cache-components'          // NF-017 when process.env.NF_CACHE_MODEL is undefined
export function hostBasePath(): string                              // process.env.NF_BASE_PATH ?? ''
```

**Decision (accepted by the user 2026-11-15; design goal 6 is reworded in `design-changes.md`):** `'use cache'` only compiles when `cacheComponents` is on, so the implementation must be chosen at build time. `withNextFederation` is **required** in every Next host. Using public config keys only, it: sets `env.NF_CACHE_MODEL` (`'cache-components'` if `config.cacheComponents` else `'legacy'`) and `env.NF_BASE_PATH` (`config.basePath ?? ''`); aliases `@next-federation/next/island-cache` to the matching `/legacy` or `/cache-components` export through `turbopack.resolveAlias` **and** a composed `webpack` function; appends `@next-federation/next` to `transpilePackages`; throws `NF-002` if any `@next-federation/*` package is in `serverExternalPackages`. It preserves every user key and composes an existing `webpack` function. Adapter entry points call `cacheModel()` and fail with `NF-017` if the wrapper is missing.

- `island-cache.legacy.ts`: `fetchIsland(target, { island, props: JSON.parse(propsJson), host: JSON.parse(hostJson), init: { next: { revalidate, tags: ['nf:' + target.remote, 'nf:' + target.remote + ':' + island] } } })`.
- `island-cache.cc.ts`: a module-level `async function cached(target, island, propsJson, hostJson, revalidate)` starting with `'use cache'`, `cacheLife({ stale: 300, revalidate, expire: Math.max(3600, revalidate * 2) })`, `cacheTag(<same two tags>)`, which **throws** when the result is not `ok` (carrying the result on the error) so failures are never cached; the exported `getPublicEnvelope` catches that error (after `unstable_rethrow`) and returns the failure. All arguments are plain data (that is why `IslandTarget` exists).

- [ ] **Step 1: Failing unit tests**

```ts
test('legacy config: env, alias, transpilePackages', () => {
  const c = withNextFederation({ basePath: '/base', transpilePackages: ['x'] })
  expect(c.env).toMatchObject({ NF_CACHE_MODEL: 'legacy', NF_BASE_PATH: '/base' })
  expect(c.turbopack.resolveAlias['@next-federation/next/island-cache']).toBe('@next-federation/next/island-cache/legacy')
  expect(c.transpilePackages).toEqual(['x', '@next-federation/next'])
})
test('cacheComponents: true selects the cache-components alias', …)
test('composes an existing webpack function and adds the alias', …)
test('keeps existing turbopack.resolveAlias and env entries', …)
test('supports a config function', …)
test('@next-federation/next in serverExternalPackages is NF-002', …)
test('cacheModel() without the env is NF-017', …)
test('legacy getPublicEnvelope passes revalidate and both tags to fetch', …)      // fake global fetch
test('cc: a failed result rejects inside the cached function and resolves to the failure outside', …)   // next/cache mocked
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm exec rstest packages/next` → PASS.

- [ ] **Step 5: Risk gate — prove the selection works from a built package under both bundlers and both models.** Probe page: `export default async function Probe() { const r = await getPublicEnvelope(target, 'Banner', '{"text":"hi"}', '{}', 60); return <pre>{cacheModel()} {String(r.ok)}</pre> }` importing from `@next-federation/next/island-cache` (remote not running, so `r.ok` is `false`; the build must still succeed and the page be static). Run (no ports needed):

```bash
pnpm build
cd test/fixtures/host-app
pnpm exec next build && pnpm exec next build --webpack
NF_CC=1 pnpm exec next build && NF_CC=1 pnpm exec next build --webpack
```

Expected: four successful builds; `/probe` is listed as static (`○`) without `NF_CC` and as prerendered (`○` or `◐`) with it. **If any of the four fails, stop and report to the user** — the fallback (documented, not built unless needed) is a one-line user-land file `lib/island-cache.ts` re-exporting the chosen implementation, passed to `createIslands`.

- [ ] **Step 6: Commit**

```bash
git add -A packages/next test spike
git commit -m "feat(next): withNextFederation config wrapper and build-time island cache model"
```

### Task 20: `@next-federation/next/server` — `RemoteIsland`, `preloadIsland`, `revalidateIsland`

**Files:**
- Create: `packages/next/src/server/{create-islands.tsx,load-island.ts,private-envelope.ts,index.ts}`; `src/client/next-island-mount.tsx`; `src/bridge.ts`; `__tests__/{load-island,bridge,revalidate}.spec.ts`
- Reference: `spike/host-app/lib/{RemoteIsland,NextIslandMount}.tsx`, `spike/proto/src/bridge.ts` + `__tests__/bridge.spec.ts`

**Interfaces — Consumes:** Tasks 4–6, 16, 17, 19. **Produces:**

```ts
// '@next-federation/next/server'   (first line of index.ts: import 'server-only')
export type AppIdentity = (ctx: { cookies: Awaited<ReturnType<typeof cookies>>; headers: Awaited<ReturnType<typeof headers>> }) =>
  HostIdentity | null | Promise<HostIdentity | null>
export type IslandSpec = { remote: string; island: string; props?: Record<string, unknown>
  private?: boolean; dynamic?: boolean; revalidate?: number; locale?: string }
export type RemoteIslandProps = IslandSpec & { fallback?: ReactNode; errorFallback?: ReactNode }
export function createIslands(federation: Federation, options?: { getIdentity?: AppIdentity }): {
  RemoteIsland(props: RemoteIslandProps): ReactElement
  preloadIsland(spec: IslandSpec): void
  revalidateIsland(remote: string, island?: string): void
}
// src/server/load-island.ts (internal, unit-tested)
export type LoadedIsland =
  | { kind: 'ok'; envelope: IslandEnvelope; token: { endpoint: string; identityKey: string } | null }
  | { kind: 'failed' } | { kind: 'anonymous' }
export function loadIsland(federation: Federation, options: { getIdentity?: AppIdentity }, spec: IslandSpec): Promise<LoadedIsland>
// src/bridge.ts
export function stripBasePath(href: string, basePath: string): string
export function toPagesRouterHref(href: string, basePath: string, locales: readonly string[]): { href: string; locale: string | undefined }
// src/client/next-island-mount.tsx ('use client')
export function NextIslandMount(props: { envelope: IslandEnvelope; host: HostContext
  token: { endpoint: string; identityKey: string } | null; errorFallback?: ReactNode }): ReactElement
```

Behaviour:
- `RemoteIsland` (sync server component) always renders `<Suspense fallback={fallback}><IslandLoader …/></Suspense>` (design §6: own boundary). `IslandLoader` awaits `loadIsland`; `ok` → `<>{css.map(href => <link key rel="stylesheet" href precedence="next-federation" />)}<NextIslandMount …/></>`; `failed`/`anonymous` → `errorFallback ?? fallback ?? null`.
- `loadIsland` is wrapped in React `cache()` keyed by `canonicalJson(spec)`, so `preloadIsland` (fire-and-forget call) and the later render share one fetch.
- Host context: `{ basePath: hostBasePath(), locale: spec.locale ?? '' }`.
- Public (`!private && !dynamic`): `getPublicEnvelope(target, island, canonicalJson(props), canonicalJson(host), spec.revalidate ?? federation.islands.revalidate)` from `@next-federation/next/island-cache`.
- Public `dynamic: true`: `fetchIsland(..., { init: { cache: 'no-store' } })` — explicit opt-in to a dynamic route (legacy) or a dynamic hole (cacheComponents).
- Private: `NF-013` if `options.getIdentity` or `federation.identity` is missing. `getIdentity({ cookies: await cookies(), headers: await headers() })` (outside any cache scope) → `null` ⇒ `{ kind: 'anonymous' }` with no remote request; else mint a token, `fetchIsland(..., { token, init: { cache: 'no-store' } })`. The token goes only into the request header. The mount receives `{ endpoint: basePath + federation.routesPath + '/token?aud=' + remote, identityKey }`.
- After every load (not inside the cached function): `federation.emit(eventFor(...))`; failures `logger.error(code)`; in development, `meta.bytes > warnBytes` → `logger.warnOnce('NF-024', …)` (finding 12).
- Every `catch` calls `unstable_rethrow(e)` first. No `connection()`.
- `revalidateIsland(remote, island?)` validates the remote (`NF-001`) and calls `revalidateTag(island ? 'nf:<remote>:<island>' : 'nf:<remote>', { expire: 0 })` (immediate expiry for deploy webhooks; check the signature against the installed Next's `next/cache` types and use the single-argument form if the installed major lacks the second parameter).
- `NextIslandMount`: bridge from `useRouter()` of `next/navigation`: `navigate = href => router.push(stripBasePath(href, host.basePath))`, same for `prefetch`; passes `basePath`/`locale` through.

- [ ] **Step 1: Failing tests** (`next/headers`, `next/cache`, `next/navigation`, `@next-federation/next/island-cache` mocked with rstest module mocks; port the cases of `spike/proto/__tests__/bridge.spec.ts` verbatim)

```ts
test('public island goes through getPublicEnvelope with canonical props and the default revalidate 60', …)
test('spec.revalidate overrides the default', …)
test('props in a different key order hit the same cache() entry', …)             // getPublicEnvelope called once for two calls
test('dynamic: true bypasses the cache with cache: "no-store"', …)
test('private island without getIdentity is NF-013', …)
test('private island, anonymous user: no remote request, kind "anonymous"', …)
test('private island: Bearer token on the request, no-store, and no token anywhere in the result', async () => {
  const r = await loadIsland(fed, { getIdentity: () => ({ sub: 'user-1' }) }, { remote: 'a', island: 'MyOrders', private: true })
  expect(seen.headers.authorization).toMatch(/^Bearer ey/); expect(seen.init.cache).toBe('no-store')
  expect(JSON.stringify(r)).not.toContain(seen.headers.authorization.slice(7))
  expect(r).toMatchObject({ kind: 'ok', token: { endpoint: '/base/api/next-federation/token?aud=a' } })
})
test('host cookies are never forwarded to the remote', …)
test('a remote 401 (expired token) is kind "failed"', …)
test('an invalid envelope is kind "failed", emits island:error with NF-004', …)   // Review Focus 2
test('a Next control-flow error thrown by cookies() propagates', …)               // unstable_rethrow mock throws it back
test('emits island:fetch with ms, bytes, attempts on success', …)
test('revalidateIsland("a") → tag nf:a; ("a","Panel") → nf:a:Panel; unknown remote NF-001', …)
test('loadIsland without the wrapper env is NF-017', …)
// bridge.spec.ts: stripBasePath / toPagesRouterHref cases from spike/proto/__tests__/bridge.spec.ts
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** `pnpm --filter @next-federation/next build && pnpm exec rstest packages/next && pnpm guardrail` → PASS, 0 violations.
- [ ] **Step 5: Commit**

```bash
git add packages/next
git commit -m "feat(next): app router RemoteIsland with both caching models, preload and revalidate"
```

### Task 21: `@next-federation/next` — JWKS and token routes (App and Pages)

**Files:**
- Create: `packages/next/src/{route-core.ts,routes.ts}`; `src/pages/api-handler.ts`; `__tests__/route-core.spec.ts`

**Interfaces — Consumes:** Task 6. **Produces:**

```ts
// '@next-federation/next/routes'  — user file: app/api/next-federation/[...nf]/route.ts
export function createFederationRoutes(federation: Federation, options: { getIdentity: AppIdentity }): {
  GET(request: Request, ctx: { params: Promise<{ nf: string[] }> }): Promise<Response>
  POST(request: Request, ctx: { params: Promise<{ nf: string[] }> }): Promise<Response>
}
// '@next-federation/next/pages/server'  — user file: pages/api/next-federation/[...nf].ts
export type PagesIdentity = (req: IncomingMessage & { cookies: Partial<Record<string, string>> }) =>
  HostIdentity | null | Promise<HostIdentity | null>
export function createFederationApiHandler(federation: Federation, options: { getIdentity: PagesIdentity }): NextApiHandler
// src/route-core.ts (shared, framework-free, unit-tested)
export function handleFederationRoute(federation: Federation, req: {
  method: string; segments: string[]; aud: string | null; secFetchSite: string | null
  identity: () => Promise<HostIdentity | null>
}): Promise<{ status: number; headers: Record<string, string>; body?: unknown }>
```

Rules: `GET jwks` → `200 publicJwks(federation)`, `Cache-Control: public, max-age=300`. `POST token`: `403` if `Sec-Fetch-Site` is present and not `same-origin`; `400` if `aud` is missing or not a configured remote; `401` if `identity()` is null; else `200 { token, expiresAt, identityKey }`, `Cache-Control: no-store`. Anything else, or `federation.identity === null`: `404`. The token endpoint authenticates with the host's own same-origin session through the user's `getIdentity`; the library never reads or sets a cookie itself. README section "Security notes": `aud` scopes a token to one remote's **server**, but island scripts run in the host origin, so any island on the page can request a token for any configured remote — `aud` is not isolation between remotes in the browser (review requirement).

- [ ] **Step 1: Failing tests**

```ts
test('GET jwks returns public keys only, cacheable for 300 s', …)
test('POST token returns token, expiresAt and identityKey with no-store', …)     // token verifies; aud = requested remote
test('POST token for an unknown aud is 400', …); test('missing aud is 400', …)
test('POST token without a session is 401', …)
test('cross-site POST (Sec-Fetch-Site: cross-site) is 403 and identity() is not called', …)
test('GET token and POST jwks are 404', …); test('no identity config: everything is 404', …)
test('the same identity yields the identityKey that loadIsland gave the mount', …)
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** core + the two thin wrappers. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/next
git commit -m "feat(next): jwks and session-bound token routes for app and pages routers"
```

### Task 22: Port `host-app` fixture + App Router e2e (both caching models)

**Files:**
- Modify (in `test/fixtures/host-app`, moved in Task 19): `next.config.ts`, `package.json`, every `app/**/page.tsx`, `app/layout.tsx`
- Delete: `lib/{RemoteIsland,NextIslandMount,RemoteComponent,island-cache.cc,island-cache.legacy}.tsx|ts`, `app/cart/`, `app/probe/`, `app/api/nf/`
- Create: `lib/federation.ts` (new), `app/api/next-federation/[...nf]/route.ts` (`export const { GET, POST } = routes`), `app/api/revalidate/route.ts` (POST → `revalidateIsland('a')`), `app/preload/page.tsx`, `test/e2e/static.spec.ts`
- Modify: `test/e2e/app-router.spec.ts`

**Interfaces — Consumes:** Tasks 19–21. Fixture `lib/federation.ts`:

```ts
import 'server-only'
const port = process.env.NF_PORT ?? '3100'
export const federation = defineFederation({
  remotes: { a: { origin: 'http://127.0.0.1:4100' }, b: { origin: 'http://127.0.0.1:4101' },
             fake: { origin: 'http://127.0.0.1:4102' }, down: { origin: 'http://127.0.0.1:4199' } },
  identity: { issuer: `http://localhost:${port}`, signingKeys: process.env.NF_SIGNING_KEY! },   // from test/e2e/fixtures/test-signing-key.json
})
const getIdentity: AppIdentity = ({ cookies }) => { const sub = cookies.get('nf-user')?.value; return sub ? { sub } : null }
export const { RemoteIsland, preloadIsland, revalidateIsland } = createIslands(federation, { getIdentity })
export const routes = createFederationRoutes(federation, { getIdentity })
```

`next.config.ts`: `export default withNextFederation({ cacheComponents: process.env.NF_CC === '1', distDir: process.env.NF_CC === '1' ? '.next-cc' : '.next', outputFileTracingRoot, turbopack: { root } })`. No alias, no `transpilePackages` in the fixture — the wrapper owns those.

- [ ] **Step 1: Port the pages** to the factory's `RemoteIsland`. `/nav/[slug]` passes only `{ slug }` (no `basePath` prop). `/preload` calls `preloadIsland` in the page before awaiting a 300 ms delay, then renders the island.

- [ ] **Step 2: Port `app-router.spec.ts`** — keep every spike test for both hosts (3100, 3102) except the Server Action and Mode A tests; change selectors only where the markup contract changed. Add:

```ts
test('the token endpoint works for a signed-in user and rejects anonymous', …)    // POST /api/next-federation/token?aud=a → 200 / 401
test('no token in the HTML, in Next\'s embedded RSC data, or in any response to the browser', …)   // page.on('response') bodies scanned for /eyJ[\w-]+\.[\w-]+\.[\w-]+/
test('preloadIsland: one island request for preload + render', …)                 // count requests seen by the fake remote
test('the island link renders the host-relative href and navigates client-side', …)
```

`static.spec.ts` (runs only when `NF_MODE=prod`; this is gate i through a production host):

```ts
for (const [name, port] of [['legacy', 3100], ['cacheComponents', 3102]] as const) {
  test(`${name}: a page with a public island is prerendered`, async ({ request }) => {
    const log = readFileSync(`test/e2e/.logs/host-app-${port}.build.log`, 'utf8')
    expect(log).toMatch(/^[├└┌] [○●◐] \/static\b/m)
    expect(log).toMatch(/^[├└┌] ƒ \/orders\b/m)                                   // private island: dynamic, by design
    const res = await request.get(`http://localhost:${port}/static`)
    expect(await res.text()).toContain('nf-product-panel')                        // island HTML is in the prerendered output
  })
}
test('revalidateIsland makes the next request pick up new remote content', …)     // gate g through a Next host: route handler in the fixture calls revalidateIsland('a')
```

- [ ] **Step 3: Run the four cells** (user, ports free): `pnpm e2e:dev -- app-router && pnpm e2e:dev:webpack -- app-router && pnpm e2e:prod -- app-router static && pnpm e2e:prod:webpack -- app-router static`. Expected: all passed in every cell; a webpack pass with a Turbopack failure is a failure.
- [ ] **Step 4: Commit**

```bash
git add -A test
git commit -m "test: port app router host to the library; e2e in dev and production, both bundlers"
```

### Task 23: `@next-federation/next/pages` + port `host-pages` fixture + e2e

**Files:**
- Create: `packages/next/src/pages/{create-pages-islands.ts,remote-island.tsx,index.ts,server.ts}`; `__tests__/pages-islands.spec.ts`
- Move: `git mv spike/host-pages test/fixtures/host-pages`
- Delete in the fixture: `lib/{PagesIsland,RemoteComponent}.tsx`, `pages/cart.tsx`, `pages/api/nf/`
- Modify: fixture `lib/federation.ts`, `next.config.ts` (`withNextFederation`, `reactStrictMode: true`), every page; `test/e2e/pages-router.spec.ts`
- Create: fixture `pages/api/next-federation/[...nf].ts`
- Reference: `spike/host-pages/lib/{PagesIsland.tsx,federation.ts}`

**Interfaces — Produces:**

```ts
// '@next-federation/next/pages/server'
export type IslandProps = { remote: string; envelope: IslandEnvelope | null; host: HostContext
  token: { endpoint: string; identityKey: string } | null }            // JSON-serialisable: no undefined
export function createPagesIslands(federation: Federation, options?: { getIdentity?: PagesIdentity }): {
  getIslandProps(ctx: GetServerSidePropsContext | GetStaticPropsContext,
    spec: { remote: string; island: string; props?: Record<string, unknown>; private?: boolean }): Promise<IslandProps>
}
// '@next-federation/next/pages'   (safe to import in page components)
export function RemoteIsland(props: IslandProps & { fallback?: ReactNode; errorFallback?: ReactNode }): ReactElement
```

Rules: `host = { basePath: hostBasePath(), locale: ctx.locale && ctx.locale !== ctx.defaultLocale ? ctx.locale : '' }`. Public: `fetchIsland(target, { island, props, host })` (caching is the page's own `revalidate` in `getStaticProps`). Private: requires `ctx.req` (`NF-002` when called from `getStaticProps`) and `getIdentity` (`NF-013`); anonymous or any failure → `envelope: null`. Failures emit events and log like Task 20. `RemoteIsland` renders `errorFallback ?? fallback` when `envelope` is null; else CSS through `next/head` (`<link rel="stylesheet" href key>`) plus `IslandMount` with a bridge from `next/router`: `toPagesRouterHref(href, router.basePath, router.locales ?? [])` → `router.push(target.href, undefined, { locale: target.locale })`, same for `prefetch`.

- [ ] **Step 1: Failing unit tests**

```ts
test('public island: envelope, host context from ctx.locale, token null', …)
test('default locale maps to locale ""; non-default to the locale', …)
test('private island in getServerSideProps mints a token and returns only endpoint + identityKey', …)
test('private island in getStaticProps (no req) is NF-002', …)
test('anonymous private island and failed fetch both give envelope null', …)
test('the result survives JSON.stringify → parse unchanged', …)                    // Next rejects undefined in props
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Port the fixture and `pages-router.spec.ts`** — keep every spike test (3101 and 3103 `/base` with `fr`) except Server Action and Mode A; `/nav/[slug]` passes only `{ slug }`. Add:

```ts
test('StrictMode host: islands hydrate once and no hydration warning is logged', …)
test('no token in the HTML or in __NEXT_DATA__', …)
test('with basePath and a locale the link is /base/fr/nav/two and does not double the prefix', …)   // href attribute + URL after click + no full reload
```

- [ ] **Step 5b (only if Task 18A passed): host-provided React.** The Pages fixture calls `provideHostReact()` from `@next-federation/react/share` at the top of `pages/_app.tsx` (fixture React = the islands' exact version, 19.3.1). Add to `pages-router.spec.ts`, production cells only: `test('a Pages host on the same stable React provides it: islands download no React', …)` (no `react*.js` response from `127.0.0.1:4100`/`4101` on `/two`), and to `app-router.spec.ts`: `test('an App Router host never provides its canary React: remotes share among themselves', …)`.
- [ ] **Step 6: Run the four cells** (user): `pnpm e2e:dev -- pages-router && pnpm e2e:dev:webpack -- pages-router && pnpm e2e:prod -- pages-router && pnpm e2e:prod:webpack -- pages-router`. Expected: all passed.
- [ ] **Step 7: Commit**

```bash
git add -A packages/next test spike
git commit -m "feat(next): pages router islands; port pages host and e2e with basePath and i18n"
```

### Task 24: Robustness, Review Focus and measurement e2e; cross-browser

**Files:**
- Modify: `test/e2e/{robustness,measure}.spec.ts`, `test/e2e/playwright.config.ts`, `test/e2e/fixtures/fake-remote.ts`
- Create: in both Next fixtures: pages `twins`, `tampered`, `big-props` (alongside the existing `down`, `slow`, `inject`); `docs/measurements.json` (output)

**Interfaces — Consumes:** everything. `fake-remote.ts` (port 4102) gains the remaining `/_nf/island/<case>` cases: `ForeignBootstrap` (valid envelope, `bootstrap` on `http://127.0.0.1:4199`), `VersionTwo` (`protocolVersion: 2`), `NotJson` (200 `text/html`), `Echo` (returns the decoded props length and method in the HTML; counts requests at `/_stats`).

- [ ] **Step 1: Port `robustness.spec.ts`** for the three Next hosts (keep: remote down → 200 + fallback; slow remote → fallback in < 3500 ms; script injection inert; SPA injection). Replace the `nf-test-ttl` test with a signed-out private island showing its fallback. Add:

```ts
test('two identical islands on one page are both live with independent state and distinct ids', async ({ page }) => {   // Review Focus 1
  await page.goto(`${host.url}/twins`)
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2)
  await page.getByTestId('counter').first().click()
  await expect(page.getByTestId('counter').first()).toHaveText('count 1'); await expect(page.getByTestId('counter').last()).toHaveText('count 0')
  const ids = await page.locator('[data-nf-root] [id]').evaluateAll((els) => els.map((e) => e.id))
  expect(new Set(ids).size).toBe(ids.length)
})
test('an envelope with a foreign bootstrap URL shows the fallback and the URL is never requested', …)        // Review Focus 2
test('an unknown protocol major and a non-JSON 200 both show the fallback', …)
test('props above the GET limit travel by POST and render; equal props in another key order reuse the cache', …)  // Review Focus 3, via /_stats
test('unicode props render intact', …)
test('no hydration warning or console error on any island page', …)
```

- [ ] **Step 2: Port `measure.spec.ts`** (`NF_MEASURE=1`, prod only): island JS cost per remote, and for each Next host the count of an HTML marker **and** of a marker placed only in the RSC payload (a unique string prop echoed by a client component's props), written to `docs/measurements.json`. This closes the "RSC payload duplication count" gap and feeds the Phase 5 transport decision. Expectations to assert (fail the spec if exceeded, so a regression is visible): without sharing, ≤ 84 KB gzip per distinct remote (spike: ~76 KB); with sharing (Task 18B), first remote ≤ 84 KB, each further same-React remote ≤ 30 KB, and ≤ 30 KB per remote when a Pages/SPA host provides React. The report records both `share: true` and `share: false` runs.
- [ ] **Step 3: Add browsers.** `playwright.config.ts` projects: `chromium` (all specs), plus `firefox` and `webkit` running `app-router`, `pages-router`, `lifecycle` when `NF_BROWSERS=all`. Add root script `e2e:browsers` = `NF_BROWSERS=all pnpm e2e:prod`.
- [ ] **Step 4: Run** (user): `pnpm e2e` then `pnpm e2e:browsers`. Expected: all five runs green; Firefox and WebKit green (a failure here is a finding to report, not to skip).
- [ ] **Step 5: Commit**

```bash
git add -A test docs/measurements.json
git commit -m "test: robustness, duplicate islands, tampered envelopes, measurements, firefox and webkit"
```

### Task 25: CI matrix, spike removal, docs, release readiness

**Files:**
- Modify: `.github/workflows/ci.yml`, `pnpm-workspace.yaml`, `package.json`, `eslint.config.mjs`, `.prettierignore`, `AGENTS.md`, `README.md`
- Delete: `spike/` (everything left: `proto`, leftovers), `docs/spike/measurements.json` stays (historical)
- Create: `packages/{server,island,vite,next}/README.md` content, `docs/guides/{getting-started-app-router,getting-started-pages-router,writing-an-island-remote,sharing-components-from-a-next-app,identity,csp,caching}.md`, `.changeset/phase-2.md`

**Interfaces:** none new.

- [ ] **Step 1: CI.** Jobs: `check` (Node 24) and `node-floor` (Node 20.9, `scripts/smoke-dist.mjs` against the built packages — now covering all eight) from Task 1; `e2e-sharing` (`NF_SHARE`-free now: `pnpm e2e:prod -- sharing`, only if Task 18B shipped); `e2e` matrix `mode: [dev, prod] × bundler: [turbopack, webpack]` on Node 24 running `pnpm e2e:<cell>`; `e2e-skew`; `e2e-browsers` (prod, turbopack, Firefox + WebKit); scheduled, non-blocking: `next-canary` (fixtures on `next@canary`), `plugin-rsc-next` (installs the newest `@vitejs/plugin-rsc`, expects `NF-025` unless the pin is bumped — the job's purpose is to tell maintainers a new release exists and run the suite with `NF_ALLOW_PLUGIN_RSC=1`).
- [ ] **Step 2: Remove the spike.** `git rm -r spike`; drop `spike/*` from `pnpm-workspace.yaml`, the `spike/**` ignore from ESLint; run `pnpm install`.
- [ ] **Step 3: Docs.** READMEs per package (API table, the constraints that apply to that package). Guides must state the documented limits: props are plain JSON; context does not cross; no nested islands; no CSS isolation; island metadata never reaches `<head>`; ~76 KB gzip of JS per distinct remote, less when remotes on the same exact React version share it (measured numbers from Task 24; sharing is exact-version, production-only, never includes the flight client, and App Router hosts cannot provide their React); island HTML appears about 3× in a host page (finding 12) so keep islands small until the fetched transport ships; host trusts remote HTML (origin allowlist); CSP entries (`script-src`, `connect-src`, `style-src`); no Fast Refresh for islands inside a host; private islands make an App Router route dynamic without `cacheComponents`; events for cached islands describe the fetch that produced the envelope; the `aud` note from Task 21; the retention rule from Task 12.
- [ ] **Step 4: Verify everything**

```bash
pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm guardrail && pnpm typecheck && pnpm build && pnpm test
for p in sdk protocol core react server island vite next; do pnpm exec publint packages/$p; done
git grep -nE "next/dist|__RSC_MANIFEST|__next_f|connection\(" -- packages          # expected: no output
git grep -n "plugin-rsc" -- packages ':!packages/vite/src/plugin-rsc' ':!packages/vite/package.json' ':!**/README.md' ':!**/CHANGELOG.md'   # expected: only options/version-check references in packages/vite/src
pnpm e2e && pnpm e2e:browsers                                                      # user runs; ports free
```

Expected: every command green; the two greps as noted.

- [ ] **Step 5: Commit** (Phase 2 exit: e2e matrix green with the remote on a different site; per-user island correct; static page stays static; remote down → fallback)

```bash
git add -A
git commit -m "chore: ci e2e matrix, remove spike, package readmes and guides"
```

Publishing is **not** part of this plan: it waits on Phases 3–5.

### Task 26 (optional, gated on a Vercel account): verify Vercel Skew Protection and Deployment Protection

**Gate:** run only when the user confirms a Vercel account/team and a project for a fixture remote. Without one, skip; the docs keep the sentence "Vercel pinning is documented from Vercel's docs and not verified by this project" (`docs/guides/caching.md`), and nothing else in the plan depends on this task.

**Files:**
- Create: `test/fixtures/island-remote/api/nf.ts` (Vercel Function wrapping the built handler), `test/fixtures/island-remote/vercel.json`, `test/e2e/vercel.spec.ts`, `docs/guides/deploying-a-remote-on-vercel.md`
- Modify: `.github/workflows/ci.yml` (manual `workflow_dispatch` job `e2e-vercel`, needs secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`)

**Interfaces — Consumes:** Tasks 11, 15. Env for the spec: `NF_VERCEL_PROD_URL` (the remote's production domain), `NF_VERCEL_OLD_DEPLOYMENT_ID`.

- [ ] **Step 1: Write the spec** (skipped unless `NF_VERCEL_PROD_URL` is set)

```ts
test('the production domain serves envelopes and assets without auth (Deployment Protection on)', …)
test('a generated deployment URL is behind auth and is never used in an envelope', …)       // bootstrap/css origins === production domain
test('an island rendered by the previous deployment still loads its pinned assets after a new deploy', …)   // Skew Protection: deployment id on asset requests
test('the previous deployment still answers its build-pinned island path', …)
```

- [ ] **Step 2: Deploy twice** (user): `vercel deploy --prod` for build `v1`, note the deployment id, then again for `v2`.
- [ ] **Step 3: Run** (user): `NF_VERCEL_PROD_URL=… NF_VERCEL_OLD_DEPLOYMENT_ID=… pnpm --filter e2e exec playwright test vercel`. Expected: 4 passed. If a test fails, record what Vercel actually does in the guide and report to the user — the design's Vercel pinning paragraph then needs another change.
- [ ] **Step 4: Write the guide** with the exact pinning mechanism observed.
- [ ] **Step 5: Commit**

```bash
git add -A test docs/guides .github
git commit -m "test: verify vercel skew and deployment protection for island remotes"
```

---

# Phases 3–5 (outline only; each gets its own plan)

### Phase 3 — Island Server Actions
- **Goal:** an island's Server Action runs on its own remote, cross-site, with a bearer token and no cookies, and re-renders only its own island; forms cannot be submitted before hydration.
- **Packages:** `server` (action handler at `/_nf/action`: "requires identity" gate per action/island, body size limit, 400 — not 500 — on malformed input, CORS headers on every error, `Origin` check); `island` (`<Form>` with a disabled `<fieldset>` until hydrated; per-root `callServer` in the bootstrap replacing the `NF-019` stub; 401 → `tokenClient.invalidate()` → one retry); `vite` (remove the `NF-019` build error; add dev checks: a client module importing a `'use server'` module — finding 2, actions must arrive as props — and raw `<form action={fn}>`); `react` (action events).
- **Restores from tag `spike-phase-0`:** `actions.ts`, `AddToCart.tsx`, `Form.tsx`, `actions.spec.ts`, the action halves of the skew tests.
- **Exit criteria:** e2e in all four cells: cross-site action updates the right user's island; token refresh is transparent; expired/foreign token → 401 handled; **Enter-key submit before hydration is actually pressed and blocked** (spike gap); action reaches the build that rendered the island under skew; two islands' actions never cross.

### Phase 4 — Mode A (browser)
- **Goal:** `RemoteComponent` renders a remote client component inside the host tree on the host's React, browser-only, skeleton on the server.
- **Share scopes:** Mode A uses the host's scope (`default`, host canary React under App Router); it never touches the islands' `nf-islands` scope.
- **Packages:** `core` (MF 2.0 runtime instance, `mf-manifest.json` loading, timeouts/retries/events via MF runtime plugins); `react`/`next` (`RemoteComponent`; shared singletons `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `react/jsx-dev-runtime` — finding 4; externalization guard; `requiredVersion ^19.0.0`, `strictVersion` off, refuse on major mismatch); `vite` (Mode A exposes wrapping `@module-federation/vite`; absolute `publicPath` in manifests — finding 3; exposed modules excluded from Fast Refresh — finding 5).
- **Restores from the tag:** `RemoteComponent.tsx`, `/cart`, the SPA's MF config and `CartButton`, as a `test/fixtures/mode-a-remote`.
- **Exit criteria:** e2e in all four cells, both routers: a hook runs with no "Invalid hook call"; **React context is shared with the host** (spike gap); the externalization guard fires with a clear `NF` error; remote down → fallback.

### Phase 5 — DX + v1.0
- **Goal:** a documented, typed, published v1.0.
- **Work:** TypeScript types for island props and remote modules (reuse MF `dts-plugin` where suitable); docs site; examples (incl. "sharing components from a Next app" with an adjacent island build); support matrix; Vercel verification if still open (Task 26, optional, gated on an account); the **"fetched" payload transport** decided from `docs/measurements.json`; `nf keygen` CLI; report the plugin-rsc `loadCss` bug upstream (finding 8); licence, `LICENSE` files, first publish through changesets.
- **Exit criteria:** v1.0 published; support matrix and semver policy public; all design §11 matrix cells green in CI, including `next@canary`.

---

# Traceability

### Spike findings → plan

| # | Finding | Where |
|---|---|---|
| 1 | "No colliding globals", keyed per build | Global Constraints (single global `__nf_rsc__`); Task 13 (`registerFlightScope`), Task 14 (`scopeFlightClient`, key = `publicBase`), Task 18 (e2e global check) |
| 2 | Actions must reach client components as props; dev check | **Deferred to Phase 3, because** island Server Actions are Phase 3 scope. Phase 2 fails any `'use server'` with `NF-019` (Tasks 14, 15) so nothing half-works |
| 3 | Remotes publish absolute URLs | Task 3 (`parseEnvelope` rejects relative URLs), Task 11 (500 on non-absolute), Task 14 (`NF-020`). Mode A manifests: Phase 4 |
| 4 | Hosts share React subpaths | **Deferred to Phase 4, because** it only concerns Mode A |
| 5 | Exposed modules excluded from Fast Refresh | Task 15 item 3 (islands). Mode A remotes: Phase 4. DX gap documented in Task 25 |
| 6 | Island HTML must be sanitized | Task 9 (tokenizer), Task 11 (handler strips), Task 15 (`rscCssTransform: false`; prod e2e assertion) |
| 7 | Bootstrap must keep its exports | Task 15 item 2 + build test |
| 8 | plugin-rsc: one `loadCss()` per module | Task 15 item 6 (plugin injects exactly one per island module). Upstream report: Phase 5 |
| 9 | Server and client must run the same React mode | Task 3 (`envelope.mode`), Task 11, Task 12 (`NODE_ENV=production` children), Task 13 (`NF-006`), Task 16 (inert + event) |
| 10 | Old builds need their server, each in its own process | Task 12 |
| 11 | CORS must allow `X-NF-Action` | Global Constraints (fixed allow-headers), Task 11 test |
| 12 | Island HTML ~3× per page | Task 20 (`NF-024` size warning), Task 24 (re-measure, incl. RSC payload), Task 25 (documented). "Fetched" transport: **deferred to Phase 5, because** the payload-duplication measurement was unreliable and the transport needs a render-consistent payload store; `rscPayload` stays embedded in protocol v1 and a transport field is an additive change |
| 13 | Dev-only testing hides bugs | Global Constraints (four cells); Tasks 15, 18, 22, 23, 24, 25 |
| 14 | Optimizer cache ignores plugin changes | Task 14 (`optimizerCacheDir`), Task 15 item 2 |

### Spike gaps → plan

| Gap | Where |
|---|---|
| Vercel Skew Protection / Deployment Protection | Task 26 (optional; gated on a Vercel account — none confirmed). Otherwise documented as unverified |
| Safari and Firefox | Task 24 step 3, Task 25 CI |
| RSC payload duplication count | Task 24 step 2 |
| Client-reference id prefix safety net | **Replaced, because** rewriting reference ids needs more plugin-rsc internals: the bootstrap rejects envelopes from another remote/build (`NF-010`, Task 13) and the host checks envelope origins (Task 5) |
| Next hosts as production builds | Tasks 22, 23, 25 |
| StrictMode only implicit | Task 18 (SPA), Task 23 (Pages `reactStrictMode`), Task 16 (unit) |
| Props through a real host (unicode, 2048 switch) | Task 24 |
| Gate g through a Next host cache with `revalidateTag` | Task 22 (`static.spec.ts`) |
| Enter-key submit before hydration | **Deferred to Phase 3** (forms) |
| Mode A context sharing | **Deferred to Phase 4** |
| React Router host; mixed-router hosts; Mode A SSR | Deferred to after v1.0 by design §3 |

### Independent-review requirements → plan

| Requirement | Where |
|---|---|
| Browser tokens tied to the session, dropped on 401 and identity change | Task 17 (client), Task 21 (endpoint returns `identityKey`; same-origin only), Task 6 (`identityKey`) |
| Hosts check envelope `bootstrap`/`css` belong to the remote | Task 3 (`assertEnvelopeUrls`), Task 5, Task 24 e2e |
| `aud` does not isolate remotes in the browser; document it | Task 21 README, Task 25 guides |
| Tokenizer or at-source stripping; regex is not a boundary | Task 9; at source via `rscCssTransform: false` (Task 15) |
| Actions: identity gate, body limits, 400 not 500, CORS on errors | **Deferred to Phase 3, because** no action endpoint exists before it. The island endpoint already has body limit, 400s and CORS on errors (Task 11) |
| `identifierPrefix` unique per mount, not per props | Task 3 (`applyIdPrefix`), Task 11 (`idPlaceholder`), Task 16, Task 24 e2e |
| Issuer → JWKS map from configuration, never from the token | Task 10, Task 14 (`issuers` option) |
| Retirement policy for old builds | Task 12 (`planRetention`, guide) |
| e2e against Next hosts in production mode | Tasks 15 (harness), 22, 23, 25 |

### User decisions of 2026-11-15 → plan

| Decision | Where |
|---|---|
| Shared MF scope `nf-islands` for island remotes: exact-version singletons, own-copy fallback, flight client never shared, stable-React hosts may provide | Global Constraints; **Task 18A** (proving gate, with the no-sharing fallback path); **Task 18B** (library); Task 23 step 5b (Pages host provides; App Router never); Task 24 (measurement expectations vs ~76 KB); Task 25 (CI, docs) |
| `withNextFederation()` required | Task 19 (accepted) |
| MIT licence | Global Constraints, Task 1, Task 2 scaffold |
| Node floor 20.9 for packages; workspace on Node ≥ 24 | Global Constraints, Task 1 (`node-floor` job, `smoke-dist.mjs`), Task 25 |
| Error links are GitHub blob links | Global Constraints, Task 2 (`DOCS_BASE`) |
| Vercel verification optional | Task 26 |

### Design items changed or dropped (details in `docs/specs/2026-11-15-design-changes.md`)

- `withNextFederation` is required in Next hosts (Task 19) — accepted; goal 6 reworded.
- "React dedup across remotes" moves from after-v1.0 into Phase 2 as island React sharing, conditional on the Task 18A gate (Tasks 18A, 18B).
- Factory API (`createIslands(federation, …)`) instead of bare `RemoteIsland` imports (Tasks 20, 21, 23).
- Dev warnings "private island on a static page" and "`dynamic: true` makes a static route dynamic": **not built, because** neither is detectable with public Next APIs; documented instead (Task 25).
- `MutationObserver` teardown: **not built, because** the spike's sweep + deferred cleanup check covers it with tests (Task 16).
- Host context (`basePath`, `locale`) travels in the island request (`h=`), not as user props (Tasks 3, 13).

# Open questions for the user

Answered 2026-11-15: licence (MIT), required config wrapper (accepted), Node floor (20.9), error links (GitHub), Vercel (optional Task 26). Remaining:

1. **Old-React fixture version** for the mismatch test in Task 18A: the plan uses "the previous published stable React 19 patch"; name a specific version if you want one pinned.
2. **Sharing threshold**: Task 18A treats a saving under 40 KB gzip for the second remote as a FAIL (not worth the added runtime). Change the number if you see it differently.
3. **npm publish timing** (design §14) — unchanged, after Phase 5.

# Execution Handoff

The tasks share exact interfaces across eight packages, and a wrong wire-format or lifecycle decision ships to every host, so **subagent-driven execution** (fresh implementer + fresh reviewer per task) is recommended. e2e steps need ports 3100–3103, 3999, 4100–4104 and 4200 free and are run by the user.
