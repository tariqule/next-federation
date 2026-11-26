# AGENTS.md

Guidance for contributors, human or AI, working in this repository. `next-federation` is an
open-source runtime UI federation library for Next.js. Read [docs/architecture.mdx](docs/architecture.mdx)
for how it fits together, [docs/conventions.md](docs/conventions.md) for code conventions and
[CONTRIBUTING.md](CONTRIBUTING.md) for the pull request process. Read the package README before
editing a package.

## Repo map

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.mjs  .prettierrc.json
rstest.config.ts  .alexrc  .changeset/config.json  AGENTS.md  README.md
.github/workflows/ci.yml
scripts/
  check-guardrails.mjs          grep guardrail (see Hard rules), with __tests__/check-guardrails.spec.ts
  check-error-docs.mjs          every NF code has docs/errors/<slug>.md (error pages stay .md)
  check-pack.mjs                every package packs its README, LICENSE and CHANGELOG
  docs-prose-words.mjs          prose word count of docs pages, against the budgets in docs-style.md
  publish-wait.mjs              publish workflow step: `pnpm release`, waiting out npm staged versions
  release-tags.mjs              publish workflow step: <name>@<version> tags from package.json, pushed
docs/
  index.mdx, live-demo.mdx      docs home and the live demo
  architecture.mdx              how islands and remote components work
  protocol/v1.md                published island protocol spec
  errors/<slug>.md              one page per NF code (stay .md), errors/index.mdx the section index
  guides/                       getting-started-*, writing-an-island-remote, caching, identity,
                                server-actions, csp, deployment, limits, migrating-from-nextjs-mf;
                                -reference pages hold the detail; remote-components.md,
                                sharing-components-from-a-next-app.md and limits.md are stubs
                                (released versions link to them)
  guides/remote-components/     overview, vite-remote, rspack-remote, host-configuration,
                                stylesheets, sharing-modules, links, reference, security, types,
                                sharing-from-a-next-app
  maintainers/                  notes for maintainers (docs style and word budgets, dependency bump
                                checks, live demo on Vercel)
docs-site/                      the documentation site (syncs Markdown and MDX from docs/ and packages/)
packages/
  sdk/        logger.ts, error-codes.ts, nf-error.ts, index.ts
  protocol/   constants.ts, envelope.ts, request.ts, props.ts, id-prefix.ts, bootstrap.ts (types),
              share-scope.ts (island React share scope), secure-url.ts (https rule),
              components.ts (remote components descriptor, trust registry), semver.ts (shared-module ranges),
              rsc-advisory.ts (react-server-dom-webpack advisory table, NF-041),
              action.ts (Server Action request), index.ts
  core/       config.ts (defineFederation), fetch-island.ts, events.ts, index.ts,
              identity/ (keys.ts, mint.ts, identity-key.ts, index.ts)   → export "./identity",
              components.ts (remote components descriptor fetch + verify)         → export "./components"
  react/      error-boundary.tsx, island-mount.tsx, island-registry.ts, token-client.ts, events.ts,
              host-react.ts, index.ts; provide-host-react.ts → export "./share";
              components/ (index.tsx: provideNavigation; render.tsx, runtime.ts) → export "./components",
              components/server-loader.ts (+ .browser.ts) → export "./components/server-loader"
  server/     strip-html.ts, identity-verify.ts, identity-context.ts, cors.ts, handler.ts,
              action.ts (Server Actions, requireIdentity marker), index.ts,
              node/ (listener.ts, serve-builds.ts, retention.ts, cli.ts) → export "./node", bin "nf-serve",
              node/components-descriptor.ts (components descriptor, shared with the Vite plugin),
              node/describe.ts, node/describe-cli.ts → bin "nf-describe" (any MF 2.0 remote)
              node/installed-version.ts (a project's installed package version)
  island/     bridge-context.tsx, link.tsx, form.tsx (<Form>), require-identity.client.ts,
              index.client.ts, index.server.ts, bootstrap/ (create-bootstrap.tsx, flight-scope.ts,
              share-scope.ts, call-server.ts (Server Action client), index.ts) → export
              "./bootstrap"; bootstrap/share-scope.ts → export "./share-scope"
  router/     internal (no application imports it): index.ts, create-router-module.tsx
              (RouterModule, provideRouter), document-router.tsx (default
              Link/useNavigate/usePathname/useSearchParams), safe-href.ts (same-origin guards),
              version.ts, react-router.tsx (reactRouterModule) → export "./react-router",
              host-navigation.tsx (provideNavigation's module) → "./host-navigation",
              next-host.tsx (the guarded next/link, next/navigation, next/router a
              Next.js host shares) → "./next-host",
              shims/ (next-link.tsx, next-navigation.ts, react-router.tsx: what remote builds
              rewire next/link, next/navigation and react-router to) → "./shims/*",
              build.ts (routerShimAliases, routerSharedEntry; Node only) → "./build"
  vite/       index.ts, options.ts, scope-flight-client.ts, checks.ts, share.ts (React sharing),
              code-literal.ts, trim-slashes.ts,
              plugin-rsc/ (plugin.ts, entry.rsc.tsx, entry.ssr.tsx, entry.client.tsx,
              bootstrap.client.tsx, css.ts, dev-actions.ts: dev Server Action allowlist),
              components/ (plugin.ts, options.ts, descriptor.ts, shared.ts, version.ts, types.ts:
              the components remote, nextFederationComponents)
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
  fixtures/components-remote/  Vite components remote (signed, tampered and unsigned builds; the
                               links build l1/rm1: next/link, next/navigation, react-router rewired)
  fixtures/components-context/ the React context hosts share with it
  e2e/                      playwright.config.ts, servers.ts, *.spec.ts, fixtures/jwks-server.ts,
                            data/measurements.json (island size report written by measure.spec.ts)
examples/                   runnable remotes and hosts (README.md, scripts/run.mjs; `pnpm examples:dev`)
  advanced/                 the commerce platform: 5 remotes, 2 hosts (scripts/platform.mjs; `pnpm examples:platform`);
                            each has a vercel.json for the live demo (scripts/demo-keys.mjs)
```


## Commands

Workspace tooling needs Node >= 24 and pnpm 10. Published packages target Node >= 20.9.

- `pnpm install`
- `pnpm build`: build every package in `packages/`
- `pnpm test`: rstest unit tests (`packages/*/__tests__`, `scripts/__tests__`)
- `pnpm test` also needs the React 18 unit lane installed outside the workspace (its own
  lockfile): `cd test/react18 && pnpm install --ignore-workspace`. CI uses `--frozen-lockfile`.
- `pnpm typecheck`: `tsc -b`
- `pnpm lint`: ESLint (flat config)
- `pnpm lint:docs`: inclusive-language check on docs
- `pnpm docs:words`: prose word count per docs page (budgets in `docs/maintainers/docs-style.md`)
- `pnpm guardrail`: grep guardrail (run before building)
- `pnpm check:error-docs`: every error code has a docs page (run after building)
- `pnpm format` / `pnpm format:check`: Prettier
- `pnpm check:pack`: every package's tarball contents (run after building)
- `pnpm e2e`: Playwright suites (`NF_LANE=b` runs on a second port range)
  The React sharing e2e also needs the old-React island remote installed the same way:
  `cd test/fixtures/island-remote-old-react && pnpm install --ignore-workspace`.
- `pnpm examples:smoke`: start the examples and check every page
- `pnpm examples:platform:smoke`: the same for the commerce platform (`examples/advanced`)

## Hard rules

ESLint and `pnpm guardrail` enforce the import and API rules; the e2e suites and review cover the
trust, globals and sharing rules. Do not weaken a check to make a change pass.

### Next.js internals

- Never import `next/dist/**`. Never reference `__RSC_MANIFEST`, `__next_*`, `__NEXT_*`, `__next_f`
  or `__next_require__`. Never call `connection()`. ESLint and `pnpm guardrail` enforce this; both
  must pass before every commit.
- Next APIs are allowed in `@next-federation/next`, and nowhere else:
  - `fetch` with `next: { revalidate, tags }`
  - `'use cache'`, `cacheLife`, `cacheTag`, `revalidateTag` (`next/cache`)
  - `cookies()`, `headers()` (`next/headers`)
  - `next/navigation` (including `unstable_rethrow`), `next/router`, `next/head`
  - Route Handlers, Pages API routes, `getServerSideProps`, `getStaticProps`
  - `next.config` keys `env`, `turbopack.resolveAlias` and `webpack`
- No `require.cache` patching, no React monkey-patching, no forcing `--webpack`, and no dependence on
  Next or Vercel upstream changes.
- Never silently make a static or ISR page dynamic. In `@next-federation/next`, every `catch`
  around a Next call or a fetch calls `unstable_rethrow(error)` from `next/navigation` first, so
  Next's control-flow errors are never swallowed.

### Package boundaries

- `sdk`, `protocol`, `core`, `react`, `server`, `island` and `router` import no framework (`next`,
  `vite`, `@vitejs/*`). ESLint enforces it per package. `router` imports `react-router` only in
  `src/react-router.tsx` (its `./react-router` entry) and `src/shims/react-router.tsx` (by the
  private name `@next-federation/router/real-react-router`, which the build resolves to the
  remote's own `react-router`).
- The protocol is bundler-neutral. Nothing in `protocol`, `core`, `react`, `server` or `island` may
  assume Vite. A remote is anything that serves the envelope and a bootstrap ES module that honours
  `IslandBootstrapModule`.
- Every `@vitejs/plugin-rsc*` and `virtual:vite-rsc/*` import and every `import.meta.viteRsc` use
  lives under `packages/vite/src/plugin-rsc/`. ESLint enforces it. `@vitejs/plugin-rsc` is pinned to
  exactly `0.5.39` as a dependency of `@next-federation/vite`.

### Running remote code

- The host never runs island code on its server. The one exception is server rendering of remote
  components: the host evaluates a remote's server build only when its descriptor is verified in
  that process (signed or pinned; `unsafe-dev` only when `NODE_ENV` is `development` or `test`) and
  every fetched file matches its sha384. Anything else renders in the browser only.
- The server loader evaluates only files of a verified descriptor whose sha384 matches. The host's
  Module Federation instance refuses its own Node script loader (`createScript`). A build whose
  manifest lists `remotes` of its own, or that has no manifest the loader can check, renders in the
  browser only.

### Secrets

- Host cookies are never forwarded to remotes.
- Identity tokens, host cookies and request headers never appear in HTML, prerendered output, Next's
  RSC payload, `__NEXT_DATA__`, the dev server's websocket or any browser storage. Tokens live in
  memory only. This holds for the library installed under `node_modules`, in `next dev` and in
  production, with Next's default dev source maps (`test/e2e/installed-dev.spec.ts`).
- The one exception is library development. Under `next dev`, a library linked from outside
  `node_modules` (a workspace link or `npm link`) is app code to Next's dev tooling, so React's
  debug info carries these values to the browser. `getPrivateEnvelope` warns once (`NF-037`) in that
  case, and also when `next dev` runs with source maps disabled. This never happens in a production
  build.

### Globals

- The library creates exactly one browser global: `globalThis.__nf_rsc__`, the flight-scope registry
  keyed by a build's absolute base URL. No other `globalThis` or `window` writes in library code.
- Third-party globals the library permits: the Module Federation runtime's `__FEDERATION__` (island
  React sharing and remote components), and, for remote components only, the ones Module Federation
  and `@module-federation/vite` remote code create (`__mf_module_cache__` and the `__mf_init__*`
  entries).
- Server-side slots the library creates, each keyed by a global symbol so that duplicate copies of a
  package share it:
  - `Symbol.for('next-federation.identity')` (`@next-federation/server`, `identity-context.ts`): the
    `AsyncLocalStorage` that carries a request's verified identity into Server Components and
    Server Actions.
  - `Symbol.for('next-federation.dev-server-actions')` (`@next-federation/vite`,
    `plugin-rsc/dev-actions.ts`): the dev allowlist of `'use server'` files per scope key. It exists
    only in a remote's Vite dev server; production builds never create it.
  - `Symbol.for('nf.components.verified')` (`componentTrustRegistry()` in
    `@next-federation/protocol`): the process-wide registry for remote components. It holds verified
    descriptor digests (`verified`), each remote's trust policy (`trust`), the number of server
    runtimes created (`hostRuntimes`, which numbers each runtime's layer), the last `init` per
    container name (`initLocks`; one running longer than the wait counts as hung and is no longer
    waited for), the one layer that renders every build the server loader cannot isolate
    (`unlistedLayer`), and, per build base, whether this process's server loader has loaded or
    refused it (`serverReady`; an App Router `cacheComponents` regeneration that renders before
    either keeps the components out of the static shell), and, per opaque federation key
    (`eventRoutes`, the `events` string `getComponentDescriptor` puts on each descriptor), that
    federation held weakly, so server-side component events reach its `onEvent`. Routes are never
    keyed by remote name and no callback is put on a descriptor.
- On the server, the remote code of each runtime scope sees its own `__mf_module_cache__` and
  `__mf_init__*` entries, held in the scope and never on the process-wide `globalThis`. A server
  entry that bundles its own Module Federation runtime also gets its own `__FEDERATION__`,
  `__VMOK__` and `__GLOBAL_LOADING_REMOTE_ENTRY__` there.
- Module Federation global plugin: the component runtime registers one, `nf-components-host-shares`
  (`hostSharesPlugin` in `packages/react/src/components/runtime.ts`), so a remote that bundles its
  own runtime (Rspack, webpack) resolves a `singleton: false` share to the host's copy when that
  copy satisfies its range (React and Next.js modules by their release numbers, as the descriptor
  check counts them), and otherwise to its own bundled copy, never another remote's. It
  acts only on consumers resolving from the host instance's own share scope, only for names the
  host registered, and never for `import: false` consumers; every other Module Federation
  instance and name keeps Module Federation's own choice. It returns a copy of the host's entry
  (checked by the host instance's name, with the host's module fixed). In the browser through
  Module Federation's `registerGlobalPlugins` (`__FEDERATION__.__GLOBAL_PLUGIN__`); on the server
  only in each scope's own registry (the server loader starts a scope's `__FEDERATION__` with
  it), never the process-wide one.
- Exception: `provideFallbackCopies` in `packages/react/src/components/runtime.ts` may set
  `__mf_module_cache__.share['default:<name>@<version>']`.
  - Only for a `fallback: true` entry of a verified descriptor, only with a module the host
    registered whose version satisfies the entry's range, and never over a key that is already set.
  - Never for `react`, `react/*`, `react-dom`, `react-dom/*`, `next` or `next/*`
    (`isNeverFallback`, `@next-federation/protocol`).
  - In the browser it writes `globalThis.__mf_module_cache__`. On the server it writes only the
    runtime's current scope (`ServerScope.globals`, which the server loader passes to remote code as
    its `globalThis` for the `@module-federation/vite` keys), never the process-wide global.
  - A runtime has one scope at a time: one runtime per router layer, plus one more per
    `next dev --webpack` reload. A runtime gets a new scope only when its cache holds a stale
    fallback copy, at most 4 per runtime (`MAX_SCOPES`). A timed-out load keeps the scope.
  - The key is per version, not per build. In the browser, within one page, the first build to
    cache `<name>@<version>` decides it for every build that bundles that version, in both
    directions (a build whose range excludes the host's copy can get the host's copy; a build
    the host satisfies can get another build's bundled copy). Only explicit ranges reach it (two
    builds, one bundled version, different ranges). On the server, a Vite build whose range
    excludes the host's copy while the cache holds the host's copy under its key renders in the
    browser only, and a build the host satisfies whose key holds another copy gets a new scope.
  - It depends on the pinned `@module-federation/vite` version. Re-verify it on every bump (see
    [docs/maintainers/mf-vite-init-keys.md](docs/maintainers/mf-vite-init-keys.md)).

### Island React sharing

- Islands share `react` and `react-dom` in a Module Federation share scope named `nf-islands`. It is
  separate from the scope remote components use (`default`), and lives under the library-only key
  `__FEDERATION__.__SHARE__['@next-federation/island-share@1']`.
- There is one instance per exact version: Module Federation `singleton: false`, `strictVersion`,
  and `requiredVersion` set to the remote's exact React version. `singleton: true` breaks mixed
  versions, and the RSC wire format is only guaranteed between identical React versions.
- "One provider" means one per `name@key` on the page. The key is the exact version for React's own
  entries, and `<version>+react@<reactVersion>` for any other shared library, which is bound to the
  React it imports. Libraries of one build may come from different providers (React from one
  remote, a design-system library from another on the same React), but each `name@key` is one object
  page-wide.
- Only production builds share. A development build never does. On a mismatch a remote uses its own
  bundled copy: sharing is an optimisation, never a requirement, and never couples a remote to the
  host's React.
- `react-server-dom-webpack/client` is never shared. Each build keeps its own flight client and
  registry slot.
- App Router hosts never provide React (Next runs a canary build). An SPA or Pages Router host on the
  identical stable React may opt in with `provideHostReact()` (`@next-federation/react/share`).
