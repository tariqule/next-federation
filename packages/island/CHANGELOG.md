# @next-federation/island

## 0.1.1

### Patch Changes

- 8c93baf: Fixes from the 0.1.0 reviews:
  
  - `@next-federation/next`: a components descriptor read inside the host's own `'use cache'` component, before this process loaded the build (NF-039), now gives that scope the failure profile (still static, regenerated within seconds) instead of a dynamic hole that could leave the page stuck as a partial prerender.
  - `@next-federation/next`: without `cacheComponents`, the stale-if-error age of an island is measured from when its envelope was fetched (the response's `Date`), not from the render that read it from Next's fetch cache.
  - `@next-federation/next`: the last good envelopes count their keys (which hold the props) against the 50 MiB budget.
  - `@next-federation/next`: an island the remote no longer exposes (its JSON `404`, `NF-021`) is no longer served from its last good envelope; the fallback renders at once.
  - `@next-federation/island`: `actions.timeoutMs` is one deadline across a token refresh and its retry, never twice the limit.
  - `@next-federation/vite`: the components dev server no longer warns about a page when a browser tab opens `/mf-manifest.json`, the descriptor or another file.
  - `@next-federation/react`: a remote component's fallback that uses `useId` gets the same id on the server and in the browser after a server render error.
- @next-federation/protocol@0.1.1
  - @next-federation/sdk@0.1.1
  - @next-federation/server@0.1.1

## 0.1.0

### Minor Changes

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
- c633607: Remote components: a component that throws while the server renders it no longer fails `next build` on a statically prerendered page. React error boundaries do not run on the server, so the host catches an error thrown by the exposed function component's own render, renders `fallback` marked for the browser, logs the new `NF-040` (once per build, expose and message) and lets the browser render the component after hydration. In the browser, the boundary now reports render errors: `NF-040` in the console and a `component:error` event (`nf:component`) with `remote`, `expose`, `buildId` and `error`; load failures stay reported by the runtime only. `createRemoteComponent` takes `errorFallback` (option and prop, default `fallback`), shown when the remote is unreachable, its module did not load or it threw; `fallback` is the loading state.
  
  `@next-federation/vite`: `react-server-dom-webpack` is an optional peer dependency, so npm installs a components remote on any React 19 (it never uses it). `nextFederationIslands` fails with `NF-002` and the install command for the project's React version when it is missing. A components remote's dev server warns `NF-002` once when a browser opens a page of the project, pointing to the two-config setup for keeping a standalone app. `actions.timeoutMs` (island remotes) bounds Server Action calls in the browser: a call whose response has not started in time is aborted and rejects with `NF-038` (default: no limit).

### Patch Changes

- 964a15c: Code-scanning fixes: trailing slashes on a remote's base URL and on `outDir` are trimmed in linear time (the old regex was quadratic on long slash runs). The island share scope refuses a lib name or version that names an `Object.prototype` member (such as `__proto__`) instead of writing to the prototype; that build uses its own copies. Generated Vite modules escape `<`, `>`, U+2028 and U+2029 in their literals. `IslandMount` documents its HTML trust boundary.
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
- Updated dependencies [964a15c]
- Updated dependencies [b01065a]
- Updated dependencies [82a34f5]
- Updated dependencies [955578c]
- Updated dependencies [18320fb]
- Updated dependencies [8a9994d]
- Updated dependencies [c2d3674]
- Updated dependencies [3b9ee03]
- Updated dependencies [989bcb4]
- Updated dependencies [3363000]
- Updated dependencies [eb9ecb4]
- Updated dependencies [97b61bf]
- Updated dependencies [ef708f1]
- Updated dependencies [c633607]
- Updated dependencies [510ac86]
  - @next-federation/protocol@0.1.0
  - @next-federation/server@0.1.0
  - @next-federation/sdk@0.1.0

See the release notes in .changeset until the first release.
