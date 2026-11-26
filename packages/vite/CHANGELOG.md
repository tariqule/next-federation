# @next-federation/vite

## 0.3.0

### Patch Changes

- Updated dependencies [096e505]
  - @next-federation/protocol@0.3.0
  - @next-federation/server@0.3.0
  - @next-federation/island@0.3.0
  - @next-federation/router@0.3.0
  - @next-federation/sdk@0.3.0

## 0.2.1

### Patch Changes

- 2c28803: Error and warning messages link to the new docs pages.
- @next-federation/server@0.2.1
  - @next-federation/island@0.2.1
  - @next-federation/protocol@0.2.1
  - @next-federation/router@0.2.1
  - @next-federation/sdk@0.2.1

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
- 2155c1b: Remote links work in every host, and remotes keep their own router. A remote component writes its
  links with `next/link` and `next/navigation`, React Router, or a plain `<a href>`, unchanged. The
  remote build rewires those router imports, so one build navigates through the host's router: the
  App Router and the Pages Router (provided by `@next-federation/next`'s components entries), a host
  that calls `provideNavigation`, or full page loads where the host has none. A React Router link
  inside a router the remote renders itself (a `MemoryRouter`) keeps routing inside it. A plain
  `<a href>` is never intercepted. A link navigates through the host only for a path, query or
  fragment on the page's origin; `javascript:`, `vbscript:` and `data:` hrefs render no `href`.
  
  - `@next-federation/vite`: new `links` option (default true). `nextFederationComponents` rewires
    `next/link` and `next/navigation`, and `react-router` and `react-router-dom` when the remote's
    `package.json` lists one of them and `react-router` 7 resolves from the remote's root, to shims
    (React Router 6, or `react-router-dom` alone without a resolvable `react-router`: left as it is,
    with one `NF-002` warning). A specifier listed in `shared` keeps that sharing. It
    also shares the shims' runtime, `@next-federation/router`, by default with the plugin's own copy:
    `{ requiredVersion: '>=<major>.<minor>.0 <1.0.0', fallback: true }` on 0.x, `'^<version>'` from
    1.0. `links: false` turns both off.
  - `@next-federation/react`: `provideNavigation({ useNavigate, useHref?, useLocation? })`
    (`@next-federation/react/components`) gives remote links the host's router; React Router's own
    hooks fit as they are. The component runtime warns once per remote and module when the host's
    copy of a `fallback: true` module is outside the remote's range (`NF-036`, as a warning; the
    remote uses its own copy). A remote that bundles its own Module Federation runtime (Rspack,
    webpack) now resolves a module the host registered to the host's copy when it satisfies its
    range, otherwise to its own copy, never to another remote's copy (before, the first bundled
    copy one remote loaded was given to every later remote for the life of the host process).
    Other Module Federation instances and names are left alone. A Vite build whose range excludes
    the host's copy, while the host's copy is cached under its bundled version, renders in the
    browser only on the server. Ranges in `NF-036` messages are quoted. A build of a container
    loaded after the runtime replaced its Module Federation instance (a module registered late, as
    router hosts do, or a timed-out load) now loads that build; before, it could silently load the
    build of that container name loaded before the replacement.
  - `@next-federation/router` (new, internal: imported by generated shims and host modules, not by
    application code): the shims and the document router. Its `./build` entry has the Rspack and
    webpack helpers `routerShimAliases()` and `routerSharedEntry()` (the shared entry names the
    package, never a path of the build machine, so a published `remoteEntry.js` carries none).
  - `@next-federation/next`: the App Router and Pages Router components entries provide the host's
    router to rewired remote links. The `next/link`, `next/navigation` and `next/router` they share
    with remotes that list them in `shared` get the same guards: a link off the page's origin is a
    plain anchor (a script URL gets no `href`), and `push` or `replace` off it is dropped.

### Patch Changes

- Updated dependencies [2155c1b]
- Updated dependencies [2155c1b]
  - @next-federation/server@0.2.0
  - @next-federation/protocol@0.2.0
  - @next-federation/router@0.2.0
  - @next-federation/island@0.2.0
  - @next-federation/sdk@0.2.0

## 0.1.2

### Patch Changes

- 2628599: Security: refuse a `react-server-dom-webpack` affected by [GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3) (unauthenticated remote code execution in React Server Components).
  
  - `@next-federation/vite`: the optional peer range is now `~19.0.9 || ~19.1.10 || ~19.2.9 || >=19.3.1 <20`, which excludes 19.0.0 to 19.0.8, 19.1.0 to 19.1.9, 19.2.0 to 19.2.8 and 19.3.0. An island remote's production build refuses an affected copy with the new `NF-041`, naming the version found and the first patched version of its minor line. It checks every copy the build may use, including the one next to `@vitejs/plugin-rsc` (which the server bundle gets when plugin-rsc is hoisted in npm or yarn workspaces). Experimental React builds (`0.0.0-*`) and every `19.3.0-canary-*` are refused too, since they cannot be checked against the advisory: use a patched stable release. The Vite dev server only warns. `nf-build.json` records the versions a build used (`reactServerDomWebpack`). When `react-server-dom-webpack` is missing on an affected React, the `NF-002` install command names the patched version.
  - `@next-federation/server`: `nf-serve` refuses a build whose `nf-build.json` records an affected or experimental version, or whose `reactServerDomWebpack` field is malformed or empty (`NF-041`). It does not start when that is the current build; an older build is retired (`410 NF-023`). Builds that record no version (an older `@next-federation/vite`) are served and logged once as an `NF-041` error.
  - `@next-federation/protocol`: `checkFlightClientVersion`, `flightClientAdvisoryDetail` and `RSC_ADVISORY`, the advisory table both share.
  
  **After upgrading, remove every build made with an affected version.** Upgrading and redeploying is not enough: `nf-serve` keeps the newest 3 builds (and any build under 24 hours old) running, each answering `/b/<build>/_nf/*`, Server Actions included, and Vercel keeps earlier deployments. Delete those build folders from the `nf-serve --dir` folder and restart it (or restart once with `--max-builds 1 --min-age-hours 0`); on Vercel, delete those deployments, and keep them behind Deployment Protection until then. Steps: `docs/errors/vulnerable-react-server-dom.md`.
- Updated dependencies [2628599]
  - @next-federation/server@0.1.2
  - @next-federation/protocol@0.1.2
  - @next-federation/sdk@0.1.2
  - @next-federation/island@0.1.2

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
- Updated dependencies [8c93baf]
  - @next-federation/island@0.1.1
  - @next-federation/protocol@0.1.1
  - @next-federation/sdk@0.1.1
  - @next-federation/server@0.1.1

## 0.1.0

### Minor Changes

- 82a34f5: Mode A stylesheets and modulepreload: the components build descriptor lists each exposed module's stylesheets and JS chunks (signed with the rest of the descriptor). Server-rendered remote components render their stylesheets as React stylesheet resources and modulepreload the remote entry and chunks; components first mounted in the browser insert their stylesheets with `preinit`, so a stalled stylesheet never holds a navigation.
  
  **Upgrade hosts before remotes:** older hosts compute the descriptor digest without `assets`, so they refuse new remote builds with `NF-027` (rendered in the browser only, unstyled on the server).
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
- 3b9ee03: Remote components: build-side fixes from review.
  
  - `nf-describe` and `nextFederationComponents` never write `fallback: true` for a `react`, `react-dom` or `next` module (any subpath, such as `react-dom/server`, `react/jsx-dev-runtime` or `next/head`), which hosts refuse: `nf-describe` lists such a bundled share as host-provided, and `nextFederationComponents` rejects `fallback: true` for one (`NF-002`).
  - Types are opt-in on every build path. `nextFederationComponents` signs `client/@mf-types/` only with `types: true`, never just because the folder exists. `nf-describe` signs it only with the new `--types` flag (`types: true` in `describeComponentsBuild`), and fails (`NF-002`) when `--types` finds no folder. `nf-describe --verify` no longer fails on a build that has an `@mf-types/` folder but no `types` entry (it checks only a signed index). **Rspack and webpack remotes that publish types: add `--types` to your `nf-describe` command.**
  - The per-expose declaration entry files (`@mf-types/<Name>.d.ts`) quote their module specifier with double quotes, escaped, so a file name with a quote or backslash stays valid.
  - Docs: the `NF-029` page lists the 1 MiB descriptor limit and the `nf-types` failure cases; `nf-describe` is documented in the `@next-federation/server` README.
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
- c633607: Remote components: a component that throws while the server renders it no longer fails `next build` on a statically prerendered page. React error boundaries do not run on the server, so the host catches an error thrown by the exposed function component's own render, renders `fallback` marked for the browser, logs the new `NF-040` (once per build, expose and message) and lets the browser render the component after hydration. In the browser, the boundary now reports render errors: `NF-040` in the console and a `component:error` event (`nf:component`) with `remote`, `expose`, `buildId` and `error`; load failures stay reported by the runtime only. `createRemoteComponent` takes `errorFallback` (option and prop, default `fallback`), shown when the remote is unreachable, its module did not load or it threw; `fallback` is the loading state.
  
  `@next-federation/vite`: `react-server-dom-webpack` is an optional peer dependency, so npm installs a components remote on any React 19 (it never uses it). `nextFederationIslands` fails with `NF-002` and the install command for the project's React version when it is missing. A components remote's dev server warns `NF-002` once when a browser opens a page of the project, pointing to the two-config setup for keeping a standalone app. `actions.timeoutMs` (island remotes) bounds Server Action calls in the browser: a call whose response has not started in time is aborted and rejects with `NF-038` (default: no limit).

### Patch Changes

- 964a15c: Code-scanning fixes: trailing slashes on a remote's base URL and on `outDir` are trimmed in linear time (the old regex was quadratic on long slash runs). The island share scope refuses a lib name or version that names an `Object.prototype` member (such as `__proto__`) instead of writing to the prototype; that build uses its own copies. Generated Vite modules escape `<`, `>`, U+2028 and U+2029 in their literals. `IslandMount` documents its HTML trust boundary.
- b01065a: Follow-ups to Server Actions and Next.js 15 support.
  
  - `fetchIsland` reads at most `maxBytes` of an island response (5 MiB by default, `MAX_ENVELOPE_BYTES`) and cancels the rest; a larger body fails with `NF-007`, is not retried, and the island renders its fallback. Set it with `islands.maxBytes` or per remote with `remotes.<name>.maxBytes` in `defineFederation`. `meta.bytes` now counts bytes, not characters. With `cacheComponents`, the island target is part of the island's `'use cache'` key and now carries `maxBytes`, so every cached public island envelope misses once after upgrading (one fetch per island, then cached as before).
  - `toNodeListener` (and so `nf-serve`): a request body the handler is still reading when the response finishes is errored, so the pending read settles instead of waiting forever.
  - `NF-035` no longer warns for a `formAction` button written inside `<Form>` (the island's `Form`, under any local name); a raw `<form action={...}>` still warns.
  - The dev Server Action allowlist matches files outside the root on Windows (`/@fs/C:/...` ids, either drive-letter case).
  - `withNextFederation` decides whether `cacheComponents` is available from the installed Next.js major (16 and later) instead of loading `next/cache` at config time, and reads the `next.config` folder from Windows stack frames (`C:\...` paths and `file:///C:/...` URLs).
  - `nf-types`: when a remote's current (verified) build publishes no types, its previously synced folder and `index.d.ts` entry are removed instead of being kept as stale types.
- 97b61bf: Fixes from a second new-user validation.
  
  - New error code `NF-039` (remote component deferred to request time) for a `cacheComponents` regeneration that runs before the server process has loaded a components build. It was logged as `NF-028` (rendered in the browser only), but the components still render on the server and the page stays static. Logged once per build.
  - An island remote's dev server no longer logs `NF-018` for React's own form-replay script, which React emits before a `<form>` whose `action` is a function (`<Form>`, `useActionState`). The script is still removed: island forms are disabled until they hydrate, so there is nothing to replay. Only an exact copy of a React release's script, with no attributes, is recognised; any other script still warns. `stripIslandHtml` reports it as `{ tag: 'script', attrs: '', known: 'react-form-replay' }`.
  - Private islands: when several renders start right after the host wakes from sleep, each one now replaces a token the remote refused for its stale clock, not only the first. The clock check is made per request (the token's `now` against `Date.now()` once the response is back), with at most one new token per render.
  - The `RemoteIsland` components of `@next-federation/next` (App Router and Pages Router) take `IslandMount`'s `inertOnLoadFailure` prop, so a page that passes `errorFallback` can still keep an island's server HTML when its build has been retired.
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
  - @next-federation/island@0.1.0
  - @next-federation/server@0.1.0
  - @next-federation/sdk@0.1.0
