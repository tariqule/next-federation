# Spike 28S: Mode A (Module Federation client components) with SSR

Date: 2026-11-16. Next.js 16.4.6, React 19.3.1, `@module-federation/runtime` 2.9.3,
`@module-federation/vite` 1.24.0, Vite 8.3.8 (Rolldown), Node 24.22.3, Playwright 1.65.0 (Chromium).
Code: `spike/mode-a-ssr/` (throwaway). Ports 7310 (remote), 7320–7358 (hosts).

## Verdict

**Feasible.** A Next.js 16 host can server-render a remote client component that it loads at runtime
through the MF 2.0 runtime, in the App Router and the Pages Router, in dev and prod, with Turbopack and
webpack. The browser then hydrates it on the host's React with no mismatch. No `next/dist` imports, no
compiler hooks, no `connection()`. Every gate passed. Each check was also run against a deliberately
broken setup to show it can fail.

| Gate | Result | Key evidence |
| --- | --- | --- |
| G1 App Router SSR | PASS (8/8 runs) | dev+prod × Turbopack+webpack, cold and warm request: HTML has `host=from-app-host build=b1`, click `count 1 -> count 2`, 0 bad console messages |
| G2 Pages Router SSR | PASS (8/8 runs) | same matrix, `host=from-pages-host`; Suspense waits during Pages SSR, so no preload is needed |
| G3 one React | PASS | probe `server: true` and `client: true` in every run; the negative control gives `false`/`false` plus "Invalid hook call" |
| G4 redeploy | PASS (with a small residual, see below) | 20 live rebuilds: every new build picked up in ≤ 480 ms (TTL 1 s), no restart; 19/21 old module instances collected; with 4 MB ballast per build the heap is flat (33.9 → 37.7 MB) against 34.9 → 110.6 MB when leaking on purpose |
| G5 remote down | PASS | 200 every time: a cold host shows the fallback, a warm host keeps rendering from its cache and the client falls back; recovers when the remote returns; the negative control gives 500 |
| G6 skew | PASS | server renders b1, b2 is deployed while the client's remote requests are held, the client loads only `/b/b1/*` and hydrates b1; the naive client hits "Hydration failed…" |
| G7 cacheComponents | PASS with rules | a cached descriptor (`'use cache'` + `cacheLife('minutes')`) prerenders the page fully static with the remote's markup (○); an uncached descriptor inside `<Suspense>` gives PPR (◐); an uncached descriptor outside Suspense fails the build (Next's normal rule) |
| G8 no internals | PASS | grep finds no `next/dist`, no `webpack`/`rules`/`resolveAlias`/`experimental` in any `next.config.ts`, and no `connection(`; the grep does catch a planted `next/dist` import |

## The approach (what was built)

1. **Remote** (`remote/vite.config.ts`): `@module-federation/vite` with `environments: { client, ssr }`.
   The SSR environment gets an input and `output.format: 'cjs'`. MF then emits `remoteEntry.ssr.js`
   (CommonJS) next to the browser `remoteEntry.js`, and `mf-manifest.json` advertises it as
   `metaData.ssrRemoteEntry`. `react`, `react/jsx-runtime` and the host context module
   (`nf-host-context`) are `shared` singletons with `import: false`, so neither build bundles them.
   Each build lives under an immutable `/b/<buildId>/`. `/current.json` names the current buildId and
   its manifest URL. Old builds stay available, as nf-serve retention does (`scripts/remote-server.mjs`).
2. **One loader module for both environments** (`mode-a/index.js`, a `'use client'` package). Next
   compiles it in the SSR layer on the server and in the browser layer on the client. The `react` and
   `react/jsx-runtime` it imports are therefore the React that renders it in each environment. It
   registers them, plus host-provided modules, as MF shared singletons (`lib: () => module`).
3. **Server entry loading** is done by an MF runtime plugin with two hooks:
   - `loadEntry` fetches the CJS entry graph: the entry plus every relative `require("./…")`, found
     recursively. It evaluates each file with `new Function(exports, require, module, …)`. The
     `require` it passes resolves relative files from that graph and maps `@module-federation/runtime`
     to the host's own copy. **Any other bare specifier is refused.** That refusal is what makes G3
     fail loudly instead of silently loading a second React.
   - `fetch` handles server-side manifest and entry requests through `node:http`
     (`process.getBuiltinModule`). This is required for G7: Next's instrumented `fetch` aborts loader
     I/O when a cacheComponents prerender completes, and the build then fails.
   Nothing is written to disk and no `import()` is used, so old builds can be garbage-collected (G4).
   ESM `import()` of temp files could never release them.
4. **Which build to render** is resolved per request on the server (`mode-a/server.js`, `getRemote()`):
   in a Server Component (App Router) or in `getServerSideProps` (Pages Router). The result is passed
   as a prop, `remote = { name, buildId, manifest }`. The client therefore loads exactly the build the
   server rendered, which is what makes G6 hold.
5. **Rendering**: `ErrorBoundary > Suspense(fallback) > Loaded`, where `Loaded` calls
   `use(loadExpose(remote, expose))`. Thenables are cached per `name@buildId/expose` on `globalThis`.
   On a build change the loader calls `registerRemotes([...], { force: true })` and drops the old
   thenables.

Remote component: `remote/src/Counter.tsx` uses `useState` and `useContext(HostContext)`, and exports
`remoteReact` for the G3 probe.

## Evidence

Final run: `spike/mode-a-ssr/scripts/run-all.sh`, log at `/tmp/nf28s-final.log`; key lines are quoted
below. Check scripts: `scripts/check.mjs` (G1–G3), `skew.mjs` (G6), `down.mjs` (G5),
`redeploy.mjs` (G4).

### G1 / G2 (each run: raw HTML via fetch, then Playwright)

```
app   dev  turbo   cold: {"result":"PASS","ssr":true,"streamed":true, "clicked":"count 1 -> count 2","clientProbe":true,"badConsole":0}
app   dev  turbo   warm: {"result":"PASS","ssr":true,"streamed":false,...}
app   dev  webpack cold/warm: PASS (streamed true/false)
app   prod turbo   cold/warm: PASS (streamed true/false)
app   prod webpack cold/warm: PASS (streamed true/false)
pages dev|prod × turbo|webpack, cold and warm: PASS, streamed:false in every run
```

- App Router: the first request after a build change **streams**. The shell carries the fallback,
  and the counter's HTML follows in the same response (`<div hidden id="S:0">` plus React's swap
  script). Once the module is cached, later requests render it **inline**. Both forms put the markup
  in the document.
- Pages Router: Next waits for all Suspense boundaries during SSR, so the markup is always inline,
  even on a cold cache. The `getServerSideProps` preload fallback (brief step 5) was not needed. It is
  kept behind `NF_PRELOAD=1` and works too.
- Both builds were `ƒ /` (dynamic, server-rendered on demand).

### G3 (probe compares `useState` and React's client-internals object)

Positive: `[nf-probe] server remote React === host React: true` and
`window.__nfProbe.client === true` in all 16 runs.

Negative control: the remote was built with its own React (`NF_BUNDLE_REACT=1`), the host shared no
React (`NEXT_PUBLIC_NF_NO_SHARE_REACT=1`), and the loader was allowed to resolve bare specifiers from
`node_modules` (`NF_NODE_REQUIRE_FALLBACK=1`):

```
[nf-probe] server remote React === host React: false
Invalid hook call. Hooks can only be called inside of the body of a function component...
⨯ TypeError: Cannot read properties of null (reading 'useContext')
check.mjs: "ssr": false, "clientProbe": false, result FAIL
```

With the default loader the same remote fails faster:
`remote …/loadShare__nf_host_context…cjs required "react", which the host does not provide`.

### G4 (App prod Turbopack, TTL 1 s, 20 rebuilds via `vite build` while the host runs)

```
{"id":"a1","ok":true,"pickupMs":20, ...}  … {"id":"a20","ok":true,"pickupMs":325, ...}
{"loaded":21,"collected":19,"allPickedUp":true,"maxPickupMs":438}
```

Collection is counted with a `FinalizationRegistry` on each loaded module. 2 are uncollected: the
current build and the one before it. Heap after `global.gc()` is not sensitive to a 17 KB module on its
own (baseline with no swaps: 28.5 → 32.6 MB; with swaps: 28.3 → 33.9 MB). So the test was repeated
with a ~4 MB array at module scope in every build:

```
ballast, NF_LEAK=0: heap 33.9 → 35.8 → 36.9 → 37.3 → 37.7 MB (swaps 1,5,10,15,20), collected 18/21
ballast, NF_LEAK=1: heap 34.9 → 51.3 → 71.5 → 91.1 → 110.6 MB,                    collected 0/21
pages prod ballast: 25.6 → 33.0 MB, collected 19/21, all picked up, max pickup 460 ms
app dev ballast (10 swaps): collected 10/11
final loader code (node:http fetch), app prod ballast: 33.5 → 37.5 MB, collected 19/21, max pickup 490 ms
```

Plain-Node soak (`scripts/node-leak.mjs`, 500 loads cycling 20 builds): 499/500 instances collected,
and the heap grows 10.2 → 15.3 MB with a decelerating slope (≈2.5 KB per load at the end). One
genuine leak is known and tiny: `@module-federation/vite` writes one `globalThis.__mf_init__<hash>`
key per **distinct** build (20 builds → 20 keys; reloading the same builds adds none).

### G5 (App and Pages prod)

```
remote up                 status 200, SSR markup, client counter
remote down, host warm    status 200, SSR markup (from the server cache), client shows the fallback (browser assets unreachable)
remote back               status 200, SSR markup, client counter
remote down, host cold    status 200, no descriptor → fallback on both sides, no errors
remote back (cold host)   status 200, SSR markup again within the TTL
broken build (manifest 404) status 200, fallback, exactly 1 client load attempt
negative control NF_THROW_ON_DOWN=1 (descriptor error not handled): status=500
```

One bug was found and fixed: if a rejected thenable is dropped from the cache, the browser enters an
**infinite retry loop**. React re-renders after a rejection, and each render creates a new promise
(2,955 load attempts in 1.5 s). The fix keeps the rejected thenable: the browser never retries within
the page, and the server retries after a 1 s cooldown.

### G6 (App and Pages prod; Playwright holds every `localhost:7310` request)

```
{"serverBuild":"b1","freshBuild":"b2","remoteRequests":["/b/b1"],"clientText":"host=from-app-host build=b1","clicked":true,"badConsole":0,"result":"PASS"}
```

Negative control: the client ignores the pinned build and loads `current.json`
(`NEXT_PUBLIC_NF_SKEW_NAIVE=1`):

```
"remoteRequests":["/current.json","/b/b2"], "clientText":"… build=b2",
"pageerror: Hydration failed because the server rendered text didn't match the client…", result FAIL
```

### G7 (`cacheComponents: true`, `spike/mode-a-ssr/host-cc`, prod Turbopack)

| Route | Shape | Build | Runtime |
| --- | --- | --- | --- |
| `/plain` | uncached descriptor, no Suspense | **fails**: "encountered the unstable value `Date.now()`" (fixed by switching to `performance.now()`), then the uncached `fetch` is outside Suspense (Next's blocking-route rule) | n/a |
| `/suspense` | uncached descriptor (`ttlMs: 0`) inside a host `<Suspense>` | `◐` partial prerender: the shell has the fallback | the counter streams in; G1 check PASS; a new build is picked up in 19 ms |
| `/cached` | `'use cache'` + `cacheLife('minutes')` descriptor, no host Suspense | `○` static; the prerendered HTML contains `host=from-cc-host build=b1` | G1 check PASS; after a redeploy the page serves the new build once revalidated (b1 → s3 after ~70 s) |
| `/cached-suspense` | same, plus a host `<Suspense>` | `○` static | G1 check PASS |

Failures found on the way, each a rule for the library:
- `cacheLife('seconds')` counts as dynamic. The page then fails as "uncached data outside
  `<Suspense>`".
- An in-process TTL cache in `getRemote()` hides the fetch from Next. A route that should be dynamic
  then gets **silently prerendered** with a build baked in.
- With Next's `fetch` (`NF_LOADER_FETCH=global`, the negative control), the prerender aborts loader
  I/O: `Failed to get manifest … fetch() rejects when the prerender is complete`, and the build exits
  1 on `/cached-suspense`. `node:http` avoids this.

### G8

```
$ grep -rn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir='.next*' -E "next/dist" spike/mode-a-ssr   → (exit 1, no matches)
$ grep -E "webpack\s*[(:]|rules\s*:|resolveAlias|loaders?\s*:|experimental" host-*/next.config.ts             → (exit 1)
$ grep -rn "connection(" host-* mode-a                                                                          → (exit 1)
planted mode-a/_neg.js importing next/dist/... → grep reports it (exit 0)
```

The configs use only `cacheComponents`, `distDir`, `outputFileTracingRoot`, `turbopack.root` and
`agentRules`. Next imports in host code: `next` (types), `next/cache` (`cacheLife`), and
`next/headers` (spike probe route only).

## What the library task must do

1. **`@next-federation/vite`** (remote): add the SSR environment with CJS output, keep React,
   `react/jsx-runtime` and the host-provided modules `import: false`, and publish an absolute
   `publicPath` under an immutable per-build path. Emit a descriptor naming `buildId` and the manifest
   URL. Note that the manifest labels the CJS SSR entry `type: "module"`; the loader ignores it.
2. **`@next-federation/react`** (host): one `'use client'` module that does the following:
   - Register its own `react`, `react/jsx-runtime` and the host-declared shared modules. Also
     `react-dom` and `react-dom/client` when remotes use them (Counter did not).
   - Install the server plugin: CJS graph evaluation, a `require` allow-list containing only
     `@module-federation/runtime`, and `node:http` fetch.
   - Cache thenables per build and **keep rejected ones** (server cooldown only).
   - On a build change, call `registerRemotes(force)`.
   - Render `ErrorBoundary > Suspense > use()`.
   Use package `exports` conditions (`node`/`browser`) so the server loader stays out of the
   client bundle; the spike ships it to both.
3. **Descriptor API**: resolve it in a Server Component or in `getServerSideProps`, then pass it as a
   prop. Keep the last-known descriptor if the remote is down, and return `null` (meaning fallback) if
   no descriptor was ever fetched. Under cacheComponents, use no in-process TTL cache and no
   `Date.now()`. Document the two supported shapes: a cached descriptor (`cacheLife` ≥ `minutes`,
   static) or an uncached descriptor inside `<Suspense>` (PPR).
4. **Before shipping** (design §6 prerequisites, still open): integrity check of the fetched server
   code (hashes pinned per build in the descriptor, or a signed manifest); a memory policy for
   `__mf_init__` keys per distinct build (report upstream to `@module-federation/vite`, or cap how
   many distinct builds a process loads); timeouts are in place (3 s).

## Concerns

1. **Security**: remote server code runs inside the host process, with access to its env and secrets.
   The spike has no integrity check, and `new Function` will run whatever the remote origin serves.
2. **Memory is bounded per module, not perfectly flat**: modules are collected (499/500 in the soak),
   but there is one global key per distinct build plus a few KB of residual growth per load. Also,
   MF vite's process-global `__mf_module_cache__.share` is **first-writer-wins**. A process that
   renders with two React instances (a mixed App+Pages host: vendored SSR React and `node_modules`
   React) would hand every remote the first one. Not tested here.
3. **Coupling to `@module-federation/vite` 1.24 behaviour**: the CJS SSR entry is not a documented
   option (it works because Rolldown emits the SSR entry as a chunk); the entry `require`s the host's
   `@module-federation/runtime`, so the remote's and host's runtime versions must be compatible; and
   the server loader uses `process.getBuiltinModule`, which needs Node ≥ 20.16 (the library currently
   declares ≥ 20.9). UX: in the App Router the first request after a deploy streams instead of
   rendering inline. On a warm host with the remote down, the user sees server HTML and then the
   fallback replaces it.
