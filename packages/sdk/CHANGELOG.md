# @next-federation/sdk

## 0.3.0

No changes in this release.

## 0.2.1

No changes in this release.

## 0.2.0

No changes in this release.

## 0.1.2

### Patch Changes

- 2628599: Security: refuse a `react-server-dom-webpack` affected by [GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3) (unauthenticated remote code execution in React Server Components).
  
  - `@next-federation/vite`: the optional peer range is now `~19.0.9 || ~19.1.10 || ~19.2.9 || >=19.3.1 <20`, which excludes 19.0.0 to 19.0.8, 19.1.0 to 19.1.9, 19.2.0 to 19.2.8 and 19.3.0. An island remote's production build refuses an affected copy with the new `NF-041`, naming the version found and the first patched version of its minor line. It checks every copy the build may use, including the one next to `@vitejs/plugin-rsc` (which the server bundle gets when plugin-rsc is hoisted in npm or yarn workspaces). Experimental React builds (`0.0.0-*`) and every `19.3.0-canary-*` are refused too, since they cannot be checked against the advisory: use a patched stable release. The Vite dev server only warns. `nf-build.json` records the versions a build used (`reactServerDomWebpack`). When `react-server-dom-webpack` is missing on an affected React, the `NF-002` install command names the patched version.
  - `@next-federation/server`: `nf-serve` refuses a build whose `nf-build.json` records an affected or experimental version, or whose `reactServerDomWebpack` field is malformed or empty (`NF-041`). It does not start when that is the current build; an older build is retired (`410 NF-023`). Builds that record no version (an older `@next-federation/vite`) are served and logged once as an `NF-041` error.
  - `@next-federation/protocol`: `checkFlightClientVersion`, `flightClientAdvisoryDetail` and `RSC_ADVISORY`, the advisory table both share.
  
  **After upgrading, remove every build made with an affected version.** Upgrading and redeploying is not enough: `nf-serve` keeps the newest 3 builds (and any build under 24 hours old) running, each answering `/b/<build>/_nf/*`, Server Actions included, and Vercel keeps earlier deployments. Delete those build folders from the `nf-serve --dir` folder and restart it (or restart once with `--max-builds 1 --min-age-hours 0`); on Vercel, delete those deployments, and keep them behind Deployment Protection until then. Steps: `docs/errors/vulnerable-react-server-dom.md`.

## 0.1.1

No changes in this release.

## 0.1.0

### Minor Changes

- 955578c: Next.js 15 hosts are supported: the `next` peer range is now `>=15.5.28 <17`. Islands and remote components work on Next 15 (React 19) in the App Router and the Pages Router, with Turbopack or webpack, through the legacy caching model (fetch `revalidate` and tags). `cacheComponents` stays Next 16 only: with Next 15 installed, `withNextFederation` fails with `NF-002` when `cacheComponents`, `experimental.cacheComponents` or `experimental.dynamicIO` is on. The wrapper reads the installed Next.js from the folder of the calling `next.config` (when it holds one) and from the working directory, and fails with `NF-002` when the two have different Next majors (`next build apps/web` run from a monorepo root on another Next). New `NF-037`: under `next dev`, a private island warns once when React's development debug info may carry its values to the browser: the library linked from outside `node_modules`, or `next dev --disable-source-maps`. Installed packages with Next's default dev source maps, and production builds, are not affected. Next 14 is not supported.
- 18320fb: First feature release of the foundation packages: error codes and logger (sdk), island protocol v1 (protocol), `defineFederation`, `fetchIsland` and island identity tokens (core), and `FederationErrorBoundary` (react).
- 8a9994d: Next.js 16 and SPA adapters for both federation modes.
  
  - RSC islands: `@next-federation/next` for the App Router (legacy caching and `cacheComponents`) and the Pages Router (`getIslandProps`, `RemoteIsland`), `@next-federation/vite` for island remotes, `@next-federation/server` with `nf-serve` build retention, per-user islands with ES256 identity tokens, and React shared between same-version island remotes.
  - Module Federation client components (Mode A): `createRemoteComponent` (`@next-federation/react/components`) loads a remote's client component through the Module Federation runtime into the host's React tree. Next.js hosts server-render it once the remote's server build is verified (a signed descriptor or pinned digests); otherwise it renders in the browser.
  - New error codes NF-026 to NF-030.
- c2d3674: Island Server Actions.
  
  - An island's `'use server'` functions post straight to the remote build that rendered it (`POST <base>_nf/action`, protocol v1 "Server Actions"), with the island's bearer token and never cookies. Each mount has its own action client; a rejected token is refreshed and the call resent once.
  - `<Form>` (`@next-federation/island`) keeps island forms disabled until hydration. `requireIdentity(fn)` and the Vite option `actions: { requireIdentity: true }` refuse unauthenticated actions.
  - Public islands on Next.js hosts with `getIdentity` run their actions as the signed-in user while the page stays static.
  - `nf-serve` answers its own 413/502/504 with CORS and gives `/_nf/action` a separate 8 MiB ceiling.
  - `toNodeListener` (and so `nf-serve`'s build processes) drains a request body the handler answered without reading to the end, so the next request on that keep-alive connection is not left waiting.
  - Type change: the exported `IslandProps` type (`@next-federation/next/pages`, `@next-federation/next/pages/server`) and its island token type widen `token.identityKey` to `string | null` (`null`: a public island on a host with `getIdentity`, whose actions fetch a token for whoever is signed in when they run). Code that reads `identityKey` as a `string` must handle `null`.
  - New error codes NF-031 to NF-035. NF-019 now only comes from remotes built before this release.
- 3363000: Remote components get the host's Next.js router modules and shared-module version negotiation.
  
  - `@next-federation/next/components` (App Router) and `@next-federation/next/pages/components` (Pages Router) provide the host's own `next/link` and `next/navigation` or `next/router` to remote components. Remotes list them in `shared`; a remote component that needs a module the host does not provide (another router's, or any `next/*` in an SPA) renders its fallback with the new `NF-036`.
  - A remote's `shared` entries take `requiredVersion` (checked by the host before loading, `NF-036` when unsatisfied) and `fallback: true` (the remote bundles its own copy, used when the host's copy is missing or outside the range). React never falls back. The descriptor lists each shared module with its range, its fallback flag and the exposed modules that import it, signed with the rest.
  - Host shared modules need their real semver `version` (`NF-002` otherwise). `registerSharedModules` provides modules to every remote component. `withNextFederation` records the host's Next.js version (`env.NF_NEXT_VERSION`).
  - Docs: "Mode A" is now "remote components" and "Mode B" "islands"; the guide moved to `docs/guides/remote-components.md`.
  
  **Upgrade hosts before remotes:** an older host computes the descriptor digest without `shared`, so it refuses a new remote build that shares modules besides React with `NF-027` (rendered in the browser only).
- 97b61bf: Fixes from a second new-user validation.
  
  - New error code `NF-039` (remote component deferred to request time) for a `cacheComponents` regeneration that runs before the server process has loaded a components build. It was logged as `NF-028` (rendered in the browser only), but the components still render on the server and the page stays static. Logged once per build.
  - An island remote's dev server no longer logs `NF-018` for React's own form-replay script, which React emits before a `<form>` whose `action` is a function (`<Form>`, `useActionState`). The script is still removed: island forms are disabled until they hydrate, so there is nothing to replay. Only an exact copy of a React release's script, with no attributes, is recognised; any other script still warns. `stripIslandHtml` reports it as `{ tag: 'script', attrs: '', known: 'react-form-replay' }`.
  - Private islands: when several renders start right after the host wakes from sleep, each one now replaces a token the remote refused for its stale clock, not only the first. The clock check is made per request (the token's `now` against `Date.now()` once the response is back), with at most one new token per render.
  - The `RemoteIsland` components of `@next-federation/next` (App Router and Pages Router) take `IslandMount`'s `inertOnLoadFailure` prop, so a page that passes `errorFallback` can still keep an island's server HTML when its build has been retired.
- c633607: Remote components: a component that throws while the server renders it no longer fails `next build` on a statically prerendered page. React error boundaries do not run on the server, so the host catches an error thrown by the exposed function component's own render, renders `fallback` marked for the browser, logs the new `NF-040` (once per build, expose and message) and lets the browser render the component after hydration. In the browser, the boundary now reports render errors: `NF-040` in the console and a `component:error` event (`nf:component`) with `remote`, `expose`, `buildId` and `error`; load failures stay reported by the runtime only. `createRemoteComponent` takes `errorFallback` (option and prop, default `fallback`), shown when the remote is unreachable, its module did not load or it threw; `fallback` is the loading state.
  
  `@next-federation/vite`: `react-server-dom-webpack` is an optional peer dependency, so npm installs a components remote on any React 19 (it never uses it). `nextFederationIslands` fails with `NF-002` and the install command for the project's React version when it is missing. A components remote's dev server warns `NF-002` once when a browser opens a page of the project, pointing to the two-config setup for keeping a standalone app. `actions.timeoutMs` (island remotes) bounds Server Action calls in the browser: a call whose response has not started in time is aborted and rejects with `NF-038` (default: no limit).
- 510ac86: Fixes from a new-user validation, and review follow-ups.
  
  - Private islands with `partialPrefetching` (create-next-app 16's default): the island token is minted without `Date.now()`, so Next no longer logs "encountered the unstable value `Date.now()` while prerendering" on every signed-in request. The token's clock is the monotonic wall clock, corrected with `Date.now()` once the remote request has returned; a token the remote refused because the clock had fallen behind (the host slept) is replaced once. `mintIslandToken` takes an optional `now` (Unix seconds).
  - The token endpoint answers an anonymous visitor with `200 {"token":null}` instead of `401`, so a signed-out Server Action no longer shows a browser console error. `400` and `403` are unchanged. The island token client treats `{ token: null }` as anonymous (no `Authorization`), and still accepts a `401` from older hosts.
  - Server Action responses without an NF code are reported by status: `404` is `NF-031`, `413` is `NF-032` (the body is larger than the remote accepts), and a `5xx`, another status, another content type or an empty body is the new `NF-038` (Server Action request failed). Previously all were `NF-031`.
  - Island code that cannot load in the browser (its bootstrap, or a client chunk while hydrating) reports `NF-011`, not `NF-012`, and the island renders its `errorFallback`. Without an `errorFallback` of its own (or with the new `IslandMount` prop `inertOnLoadFailure`) a bootstrap that fails to load still keeps the server HTML, inert.
  - Remote components on a static `cacheComponents` page: after `next start`, a regeneration that runs before the process has loaded the build no longer keeps the components' fallback as the page for a revalidate window. That render is left out of the static shell (the components render per request, waiting for the build) and logs `NF-039` (remote component deferred to request time) once per build; the next regeneration is static again. `next build` and `next dev` are unchanged.
  - `@next-federation/vite` dev: React (`react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, `react-dom/client`) is pre-bundled when the dev server starts and `@next-federation/island` is never pre-bundled, so the first host load against a cold optimizer cache no longer ends with two Reacts. Vite 8's browser console forwarding (`server.forwardConsole`) is off in island and components remotes unless their config sets it.
  - `types: true`: TypeScript 7 (no compiler API) gets a clear `NF-002` warning naming the fix (`typescript@6`) instead of "Cannot read properties of undefined". The optional `typescript` peer is `>=5.0.0`, with no upper bound, so `npm install` accepts a remote on TypeScript 7 (create-vite's default).
  - `nf-serve` no longer serves build bookkeeping from a components build's `client/` folder: dot folders and files (`.vite/manifest.json`, `.vite/mf-preload.json`) and `mf-stats.json` answer `404`.
  - `fetchIsland` aborts the request when a body passes `maxBytes`, not only its own read.
  - `NF-035` treats only a `Form` imported from `@next-federation/island` as safe (a local `Form` component is an ordinary component), and checks files that use `formAction` without any `action` prop.
  - The remote components server loader times container inits with `performance.now()` instead of `Date.now()` (a render with `partialPrefetching` flags the wall clock).
  - In the browser, a module registered after a remote component loaded (`registerShared`) no longer leaves the replaced Module Federation instance in `__FEDERATION__.__INSTANCES__`.
