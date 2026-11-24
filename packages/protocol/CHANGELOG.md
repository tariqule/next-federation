# @next-federation/protocol

## 0.2.0

### Minor Changes

- 2155c1b: React 18 hosts can embed islands and remote components. A Next 15 Pages Router host or a React 18
  SPA runs on React 18.3 or 19. App Router hosts keep Next's own React.
  
  - `@next-federation/react` and `@next-federation/next`: the `react` and `react-dom` peers widen
    from `^19.0.0` to `^18.3.0 || ^19.0.0`. No other package's peers change.
  - `@next-federation/vite`: `nextFederationComponents` takes a new `react` option, a semver range
    (default `^19.0.0`) that declares the host React range a components remote accepts. Set `'^18.3.0 || ^19.0.0'`
    for a remote that runs in React 18 hosts. An invalid range throws `NF-002`.
  - `@next-federation/server` (the descriptor, also for `nf-describe`): a build lists React's
    modules in its descriptor's `shared` only for a range other than `^19.0.0`, so a default build's
    descriptor and digest are unchanged. `@next-federation/react`: a host checks its React against
    `^19.0.0` for each React module a descriptor does not list, and renders the fallback with
    `NF-036` when it does not satisfy it. `@next-federation/protocol` exports `DEFAULT_REACT_RANGE`
    and `HOST_REACT_MODULES`, and refuses a descriptor whose React entry lists `exposes`.
  - Upgrade App Router hosts to this release before widening a remote's React range: hosts on 0.1.x
    compare a listed range with their raw React version, and the canary React an App Router host
    runs matches none, so they render that remote's components as the fallback (`NF-036`). Remotes
    on the default range are unaffected.
  - `nf-describe`: re-describing a Rspack or webpack build whose React shares declare a range other
    than `^19.0.0` (for example `^19.1.0` from `package.json`) now lists React, so its descriptor
    digest changes; a host that pinned the old digest refuses the build until the pin is updated.
    Hosts now enforce that listed range: a remote re-described with `^19.3.1` renders its fallback
    (`NF-036`) on an App Router host whose canary React is 19.3.0 by its release numbers, where an
    undeclared build loads. React shares without a readable range are left out (hosts assume
    `^19.0.0`), and `nf-describe` warns (`NF-036`).

### Patch Changes

- @next-federation/sdk@0.2.0

## 0.1.2

### Patch Changes

- 2628599: Security: refuse a `react-server-dom-webpack` affected by [GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3) (unauthenticated remote code execution in React Server Components).
  
  - `@next-federation/vite`: the optional peer range is now `~19.0.9 || ~19.1.10 || ~19.2.9 || >=19.3.1 <20`, which excludes 19.0.0 to 19.0.8, 19.1.0 to 19.1.9, 19.2.0 to 19.2.8 and 19.3.0. An island remote's production build refuses an affected copy with the new `NF-041`, naming the version found and the first patched version of its minor line. It checks every copy the build may use, including the one next to `@vitejs/plugin-rsc` (which the server bundle gets when plugin-rsc is hoisted in npm or yarn workspaces). Experimental React builds (`0.0.0-*`) and every `19.3.0-canary-*` are refused too, since they cannot be checked against the advisory: use a patched stable release. The Vite dev server only warns. `nf-build.json` records the versions a build used (`reactServerDomWebpack`). When `react-server-dom-webpack` is missing on an affected React, the `NF-002` install command names the patched version.
  - `@next-federation/server`: `nf-serve` refuses a build whose `nf-build.json` records an affected or experimental version, or whose `reactServerDomWebpack` field is malformed or empty (`NF-041`). It does not start when that is the current build; an older build is retired (`410 NF-023`). Builds that record no version (an older `@next-federation/vite`) are served and logged once as an `NF-041` error.
  - `@next-federation/protocol`: `checkFlightClientVersion`, `flightClientAdvisoryDetail` and `RSC_ADVISORY`, the advisory table both share.
  
  **After upgrading, remove every build made with an affected version.** Upgrading and redeploying is not enough: `nf-serve` keeps the newest 3 builds (and any build under 24 hours old) running, each answering `/b/<build>/_nf/*`, Server Actions included, and Vercel keeps earlier deployments. Delete those build folders from the `nf-serve --dir` folder and restart it (or restart once with `--max-builds 1 --min-age-hours 0`); on Vercel, delete those deployments, and keep them behind Deployment Protection until then. Steps: `docs/errors/vulnerable-react-server-dom.md`.
- Updated dependencies [2628599]
  - @next-federation/sdk@0.1.2

## 0.1.1

### Patch Changes

- @next-federation/sdk@0.1.1

## 0.1.0

### Minor Changes

- 82a34f5: Mode A stylesheets and modulepreload: the components build descriptor lists each exposed module's stylesheets and JS chunks (signed with the rest of the descriptor). Server-rendered remote components render their stylesheets as React stylesheet resources and modulepreload the remote entry and chunks; components first mounted in the browser insert their stylesheets with `preinit`, so a stalled stylesheet never holds a navigation.
  
  **Upgrade hosts before remotes:** older hosts compute the descriptor digest without `assets`, so they refuse new remote builds with `NF-027` (rendered in the browser only, unstyled on the server).
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
- 989bcb4: Remote components server-render in mixed-router hosts (App Router and Pages Router routes in one Next.js host). Each router layer has its own remote component runtime: its own Module Federation host instance, its own sha384-checked copy of each remote build's server code, and its own copy of the globals that copy keeps its state in (a Vite remote's `__mf_module_cache__`/`__mf_init__…`, a Rspack or webpack remote's bundled `__FEDERATION__` registry), so a remote copy renders on the React of the route that renders it. This isolates cooperating builds; it is not a sandbox.
  
  - Builds the server loader knows how to isolate (`@module-federation/vite` 1.24.0, `@module-federation/enhanced` 2.9.2 and 2.9.3) server-render in every layer. Any other build server-renders in one layer per process only and in the browser elsewhere (`NF-028`, logged once).
  - A build whose manifest lists `remotes` of its own, or without a manifest the server loader could check, renders in the browser only on the server in every host (`NF-028`): its nested remotes would load outside the sha384 check.
  - Fallback copies are never seeded for `react`, `react-dom`, `next` or any of their subpaths, and a fallback copy is checked by version as well as name.
  - `@next-federation/protocol` no longer exports `NEVER_FALLBACK`: use `isNeverFallback(name)`, which covers every subpath of `react`, `react-dom` and `next`.
  - A descriptor whose `shared` field says `fallback: true` for such a module (`react-dom/server`, `next/head`, ...) is refused as an invalid descriptor.
  - A remote's server entry initialises in one layer at a time; an initialisation that waits more than 10 s fails and is retried after the cooldown instead of overlapping. A load timeout reuses the layer's scope, so repeated timeouts no longer grow memory.
  - A failed load keeps its real error code (`NF-029` for a network failure, `NF-027` for a tampered file) instead of being reported as an unverified container.
  - Remote server code is evaluated with `document`, `window` and `self` shadowed, so a server-side polyfill of those globals cannot make a remote's runtime use the real global object.
  - Edge case: a server entry that declares `let` or `const` `document`, `window` or `self` at its top level cannot be evaluated this way (a `SyntaxError`: those names are parameters of the wrapper), so it does not server-render. `var` declarations and declarations inside functions are unaffected.
- 3363000: Remote components get the host's Next.js router modules and shared-module version negotiation.
  
  - `@next-federation/next/components` (App Router) and `@next-federation/next/pages/components` (Pages Router) provide the host's own `next/link` and `next/navigation` or `next/router` to remote components. Remotes list them in `shared`; a remote component that needs a module the host does not provide (another router's, or any `next/*` in an SPA) renders its fallback with the new `NF-036`.
  - A remote's `shared` entries take `requiredVersion` (checked by the host before loading, `NF-036` when unsatisfied) and `fallback: true` (the remote bundles its own copy, used when the host's copy is missing or outside the range). React never falls back. The descriptor lists each shared module with its range, its fallback flag and the exposed modules that import it, signed with the rest.
  - Host shared modules need their real semver `version` (`NF-002` otherwise). `registerSharedModules` provides modules to every remote component. `withNextFederation` records the host's Next.js version (`env.NF_NEXT_VERSION`).
  - Docs: "Mode A" is now "remote components" and "Mode B" "islands"; the guide moved to `docs/guides/remote-components.md`.
  
  **Upgrade hosts before remotes:** an older host computes the descriptor digest without `shared`, so it refuses a new remote build that shares modules besides React with `NF-027` (rendered in the browser only).
- eb9ecb4: Remote components can publish prop types for hosts (opt-in).
  
  - `nextFederationComponents({ types: true })` (off by default in 0.x) emits the exposed modules' TypeScript declarations into the build (`client/@mf-types/`, Module Federation's layout) with the project's own `typescript`, without comments (the `/*!` comments TypeScript's `removeComments` keeps are stripped too) and with paths relative to the Vite root. The literal values of constants (exported or referenced through `typeof`), `as const` objects and enums are published as written, including values inlined from outside the root: don't expose a module whose type graph reaches a secret. A declaration that names an absolute path or a path above the root makes the build warn and publish no types. It writes `client/@mf-types/index.json` (every declaration file with its sha384) and signs that one index in the descriptor's new `types` field (`{ index, integrity }`), so the descriptor stays small. Without `typescript`, or when TypeScript cannot emit the declarations, the build warns and publishes no types. `nf-describe --types` indexes and signs a `client/@mf-types/` folder too (only with `--types`), and `--verify` checks a signed index.
  - `nf-types` (`@next-federation/next`) downloads the declarations of each remote's current build into `next-federation-types/`, only from a descriptor verified with the remote's `components.ssr` keys or pins, only through an index and files whose raw bytes match their sha384, every body read with a size limit, and writes `index.d.ts`. `RemoteProps<'shop', './Cart'>` then gives `createRemoteComponent` the remote's real props.
  - `verifyDescriptorTrust` and `readBodyLimited` (`@next-federation/core/components`): check a descriptor against a remote's trust policy whether or not the build has server code; read a response body with a byte limit. The descriptor fetch now refuses a body over 1 MiB (`NF-029`) without buffering it.
  - Docs: "Types" and "Devtools" sections in `docs/guides/remote-components.md` (the Module Federation Chrome devtools read remote components' snapshot as for any MF host).
  
  **Upgrade hosts before remotes:** an older host computes the descriptor digest without `types`, so it refuses a new remote build with declarations with `NF-027` (rendered in the browser only). Leave `types` off until hosts are upgraded.

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
- Updated dependencies [955578c]
- Updated dependencies [18320fb]
- Updated dependencies [8a9994d]
- Updated dependencies [c2d3674]
- Updated dependencies [3363000]
- Updated dependencies [97b61bf]
- Updated dependencies [c633607]
- Updated dependencies [510ac86]
  - @next-federation/sdk@0.1.0

See the release notes in .changeset until the first release.
