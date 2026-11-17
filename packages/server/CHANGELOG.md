# @next-federation/server

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
- 3b9ee03: Remote components: build-side fixes from review.
  
  - `nf-describe` and `nextFederationComponents` never write `fallback: true` for a `react`, `react-dom` or `next` module (any subpath, such as `react-dom/server`, `react/jsx-dev-runtime` or `next/head`), which hosts refuse: `nf-describe` lists such a bundled share as host-provided, and `nextFederationComponents` rejects `fallback: true` for one (`NF-002`).
  - Types are opt-in on every build path. `nextFederationComponents` signs `client/@mf-types/` only with `types: true`, never just because the folder exists. `nf-describe` signs it only with the new `--types` flag (`types: true` in `describeComponentsBuild`), and fails (`NF-002`) when `--types` finds no folder. `nf-describe --verify` no longer fails on a build that has an `@mf-types/` folder but no `types` entry (it checks only a signed index). **Rspack and webpack remotes that publish types: add `--types` to your `nf-describe` command.**
  - The per-expose declaration entry files (`@mf-types/<Name>.d.ts`) quote their module specifier with double quotes, escaped, so a file name with a quote or backslash stays valid.
  - Docs: the `NF-029` page lists the 1 MiB descriptor limit and the `nf-types` failure cases; `nf-describe` is documented in the `@next-federation/server` README.
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
- ef708f1: Fixes from the third validation round (medium and low findings).
  
  - `nf-serve` compresses what it serves. JavaScript, CSS, JSON, SVG, HTML, source maps and text files of at least 1 KB, components descriptors and public JSON island envelopes are sent brotli- or gzip-encoded per `Accept-Encoding` (q-values, `identity` and `*;q=0` honoured), with `Vary: Accept-Encoding`; `Cache-Control`, CORS and the rest of the headers are unchanged, and a build's strong `ETag` becomes weak once encoded. Compressed files are cached in memory per path, modification time and size (new option `compressionCacheBytes`, default 64 MiB). Range and `HEAD` requests, images and fonts, bodies a build encoded itself, Server Action results and envelopes of requests that carried an identity token are sent as they are. Uses `node:zlib` only.
  - The `NF-007` and `NF-008` log lines name the island URL (origin and path, never the query or the token) and the HTTP status. When the origin answers an HTML page or a non-protocol `404`, `NF-007` adds a hint that the origin is probably not an island remote (a Next.js app cannot be one); `NF-029` adds the same hint for a components descriptor that answers `404` or HTML. A failed `fetchIsland` result carries `url` and `hint`, and `islandFailureDetail(result)` formats them.
  - A remote components build whose Module Federation manifest lists `remotes` of its own (or has no remotes list, or no JSON manifest) is refused when its descriptor is fetched: `fetchVerifiedComponentDescriptor` returns it browser-only with `NF-028`. Such a build no longer logs a misleading `NF-039` first, and the server loader is never asked to load it. When the server loader refuses a build itself, it does so before the Module Federation runtime runs, so the runtime no longer logs `Failed to get manifest #RUNTIME-003` with a stack trace, and the refusal is recorded at once for the static-regeneration check.

### Patch Changes

- b01065a: Follow-ups to Server Actions and Next.js 15 support.
  
  - `fetchIsland` reads at most `maxBytes` of an island response (5 MiB by default, `MAX_ENVELOPE_BYTES`) and cancels the rest; a larger body fails with `NF-007`, is not retried, and the island renders its fallback. Set it with `islands.maxBytes` or per remote with `remotes.<name>.maxBytes` in `defineFederation`. `meta.bytes` now counts bytes, not characters. With `cacheComponents`, the island target is part of the island's `'use cache'` key and now carries `maxBytes`, so every cached public island envelope misses once after upgrading (one fetch per island, then cached as before).
  - `toNodeListener` (and so `nf-serve`): a request body the handler is still reading when the response finishes is errored, so the pending read settles instead of waiting forever.
  - `NF-035` no longer warns for a `formAction` button written inside `<Form>` (the island's `Form`, under any local name); a raw `<form action={...}>` still warns.
  - The dev Server Action allowlist matches files outside the root on Windows (`/@fs/C:/...` ids, either drive-letter case).
  - `withNextFederation` decides whether `cacheComponents` is available from the installed Next.js major (16 and later) instead of loading `next/cache` at config time, and reads the `next.config` folder from Windows stack frames (`C:\...` paths and `file:///C:/...` URLs).
  - `nf-types`: when a remote's current (verified) build publishes no types, its previously synced folder and `index.d.ts` entry are removed instead of being kept as stale types.
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
- Updated dependencies [82a34f5]
- Updated dependencies [955578c]
- Updated dependencies [18320fb]
- Updated dependencies [8a9994d]
- Updated dependencies [c2d3674]
- Updated dependencies [989bcb4]
- Updated dependencies [3363000]
- Updated dependencies [eb9ecb4]
- Updated dependencies [97b61bf]
- Updated dependencies [c633607]
- Updated dependencies [510ac86]
  - @next-federation/protocol@0.1.0
  - @next-federation/sdk@0.1.0
