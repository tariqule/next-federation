# @next-federation/next

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
  - @next-federation/react@0.2.0
  - @next-federation/protocol@0.2.0
  - @next-federation/router@0.2.0
  - @next-federation/core@0.2.0
  - @next-federation/sdk@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [2628599]
  - @next-federation/protocol@0.1.2
  - @next-federation/sdk@0.1.2
  - @next-federation/core@0.1.2
  - @next-federation/react@0.1.2

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
  - @next-federation/react@0.1.1
  - @next-federation/core@0.1.1
  - @next-federation/protocol@0.1.1
  - @next-federation/sdk@0.1.1

## 0.1.0

### Minor Changes

- 955578c: Next.js 15 hosts are supported: the `next` peer range is now `>=15.5.28 <17`. Islands and remote components work on Next 15 (React 19) in the App Router and the Pages Router, with Turbopack or webpack, through the legacy caching model (fetch `revalidate` and tags). `cacheComponents` stays Next 16 only: with Next 15 installed, `withNextFederation` fails with `NF-002` when `cacheComponents`, `experimental.cacheComponents` or `experimental.dynamicIO` is on. The wrapper reads the installed Next.js from the folder of the calling `next.config` (when it holds one) and from the working directory, and fails with `NF-002` when the two have different Next majors (`next build apps/web` run from a monorepo root on another Next). New `NF-037`: under `next dev`, a private island warns once when React's development debug info may carry its values to the browser: the library linked from outside `node_modules`, or `next dev --disable-source-maps`. Installed packages with Next's default dev source maps, and production builds, are not affected. Next 14 is not supported.
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
- 6cd1b1c: App Router `RemoteIsland` takes `blocking` for private islands: the island renders without its own `<Suspense>`, so its HTML is in the first HTML, in place, with no streamed `fallback` and no client-side swap (as the Pages Router renders it). The page's response waits for the remote, up to the island timeout; a failed, slow or invalid island renders `errorFallback` in place with the same `NF-007`, `NF-008` or `NF-004` log, and the page answers `200`. The route has no static shell (`next build` shows `ƒ`). With `cacheComponents` the page must export `instant = false`, or `next build` fails with Next's "runtime data during prerendering" error; without `cacheComponents` (Next 16 or 15) nothing else is needed. `blocking` on a public island throws `NF-002`. The token rules are unchanged: no token in the HTML or the RSC payload, private envelopes fetched with `cache: 'no-store'`.
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
- 97b61bf: Fixes from a second new-user validation.
  
  - New error code `NF-039` (remote component deferred to request time) for a `cacheComponents` regeneration that runs before the server process has loaded a components build. It was logged as `NF-028` (rendered in the browser only), but the components still render on the server and the page stays static. Logged once per build.
  - An island remote's dev server no longer logs `NF-018` for React's own form-replay script, which React emits before a `<form>` whose `action` is a function (`<Form>`, `useActionState`). The script is still removed: island forms are disabled until they hydrate, so there is nothing to replay. Only an exact copy of a React release's script, with no attributes, is recognised; any other script still warns. `stripIslandHtml` reports it as `{ tag: 'script', attrs: '', known: 'react-form-replay' }`.
  - Private islands: when several renders start right after the host wakes from sleep, each one now replaces a token the remote refused for its stale clock, not only the first. The clock check is made per request (the token's `now` against `Date.now()` once the response is back), with at most one new token per render.
  - The `RemoteIsland` components of `@next-federation/next` (App Router and Pages Router) take `IslandMount`'s `inertOnLoadFailure` prop, so a page that passes `errorFallback` can still keep an island's server HTML when its build has been retired.
- 71a1783: Public islands on static pages, from validation rounds 3 and 4.
  
  - With `cacheComponents`, an island failure no longer turns a static page into a partial prerender for good. A failed island (or components descriptor) was cached with Next's `seconds` values, which Next leaves out of a static prerender. When the island was the page's only changing content, the regenerated shell got `revalidate: false`: Next never regenerated it again, served it `private, no-store` with the island rendered per request, kept it across restarts in `.next/server/route-cache`, and answered its RSC requests (client navigations) with 404 after a restart. A failure is now cached with `{ stale: 30, revalidate: 5, expire: 600 }`: it stays in the static shell, so the page stays static and is regenerated within about 5 seconds. NF-039 still defers on purpose; that page keeps its descriptor entries and is regenerated.
  - Stale-if-error: a public island whose fetch fails renders the last good envelope this server process fetched for the same remote, island, props and host context, for at least an hour or twice `revalidate`, instead of replacing it with the fallback. The failure is still logged with its code ("rendering its last good envelope (N s old)") and emitted as `island:error`. It applies with and without `cacheComponents` and to `getIslandProps`, which marks such a result `stale: true`. Private and `dynamic` islands are never served stale.

### Patch Changes

- b01065a: Follow-ups to Server Actions and Next.js 15 support.
  
  - `fetchIsland` reads at most `maxBytes` of an island response (5 MiB by default, `MAX_ENVELOPE_BYTES`) and cancels the rest; a larger body fails with `NF-007`, is not retried, and the island renders its fallback. Set it with `islands.maxBytes` or per remote with `remotes.<name>.maxBytes` in `defineFederation`. `meta.bytes` now counts bytes, not characters. With `cacheComponents`, the island target is part of the island's `'use cache'` key and now carries `maxBytes`, so every cached public island envelope misses once after upgrading (one fetch per island, then cached as before).
  - `toNodeListener` (and so `nf-serve`): a request body the handler is still reading when the response finishes is errored, so the pending read settles instead of waiting forever.
  - `NF-035` no longer warns for a `formAction` button written inside `<Form>` (the island's `Form`, under any local name); a raw `<form action={...}>` still warns.
  - The dev Server Action allowlist matches files outside the root on Windows (`/@fs/C:/...` ids, either drive-letter case).
  - `withNextFederation` decides whether `cacheComponents` is available from the installed Next.js major (16 and later) instead of loading `next/cache` at config time, and reads the `next.config` folder from Windows stack frames (`C:\...` paths and `file:///C:/...` URLs).
  - `nf-types`: when a remote's current (verified) build publishes no types, its previously synced folder and `index.d.ts` entry are removed instead of being kept as stale types.
- ef708f1: Fixes from the third validation round (medium and low findings).
  
  - `nf-serve` compresses what it serves. JavaScript, CSS, JSON, SVG, HTML, source maps and text files of at least 1 KB, components descriptors and public JSON island envelopes are sent brotli- or gzip-encoded per `Accept-Encoding` (q-values, `identity` and `*;q=0` honoured), with `Vary: Accept-Encoding`; `Cache-Control`, CORS and the rest of the headers are unchanged, and a build's strong `ETag` becomes weak once encoded. Compressed files are cached in memory per path, modification time and size (new option `compressionCacheBytes`, default 64 MiB). Range and `HEAD` requests, images and fonts, bodies a build encoded itself, Server Action results and envelopes of requests that carried an identity token are sent as they are. Uses `node:zlib` only.
  - The `NF-007` and `NF-008` log lines name the island URL (origin and path, never the query or the token) and the HTTP status. When the origin answers an HTML page or a non-protocol `404`, `NF-007` adds a hint that the origin is probably not an island remote (a Next.js app cannot be one); `NF-029` adds the same hint for a components descriptor that answers `404` or HTML. A failed `fetchIsland` result carries `url` and `hint`, and `islandFailureDetail(result)` formats them.
  - A remote components build whose Module Federation manifest lists `remotes` of its own (or has no remotes list, or no JSON manifest) is refused when its descriptor is fetched: `fetchVerifiedComponentDescriptor` returns it browser-only with `NF-028`. Such a build no longer logs a misleading `NF-039` first, and the server loader is never asked to load it. When the server loader refuses a build itself, it does so before the Module Federation runtime runs, so the runtime no longer logs `Failed to get manifest #RUNTIME-003` with a stack trace, and the refusal is recorded at once for the static-regeneration check.
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
- Updated dependencies [989bcb4]
- Updated dependencies [3363000]
- Updated dependencies [eb9ecb4]
- Updated dependencies [97b61bf]
- Updated dependencies [ef708f1]
- Updated dependencies [c633607]
- Updated dependencies [510ac86]
  - @next-federation/protocol@0.1.0
  - @next-federation/react@0.1.0
  - @next-federation/core@0.1.0
  - @next-federation/sdk@0.1.0
