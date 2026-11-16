# Island React sharing: proving gate (plan Task 18A)

**Verdict: PASS.** Mechanism 2 passes: a hand-rolled shim on `@module-federation/runtime` 2.9.3, with
MF `singleton: false` plus `strictVersion: true` and an exact `requiredVersion`. This is a deviation
from the brief's `singleton: true`, explained below. Task 18B runs.

Date: 2026-11-16. Production remotes, Chromium, SPA host `/shared`, run in e2e lane `NF_LANE=b`
(ports +2000).

## What was proven

| Criterion                                                                  | Result |
| -------------------------------------------------------------------------- | ------ |
| Two remotes on React 19.3.1: React and ReactDOM downloaded from one origin only, one copy evaluated | pass |
| Positive control: one remote alone shows its React chunks (detector works) | pass |
| Both islands keep independent state; `__nf_rsc__` holds two flight scopes  | pass |
| Remote `c` on React 19.3.0 works with its own copy (2 copies, versions 19.3.0 and 19.3.1, envelope `reactVersion` 19.3.0) | pass |
| Load order `c`, then `a`, then `b`: `a` and `b` still share, `c` separate (2 copies) | pass |
| Skew: v1 and v2 of one remote isolate their flight clients and share one React | pass |
| Host-provided React (SPA host on 19.3.1): zero React chunks from remotes; swap and toggle 10× leave 2 live roots | pass |
| Existing suites with `NF_SHARE=1`: lifecycle, spa, protocol-endpoint (prod and `--webpack`), skew suite | pass |
| Dev remotes unaffected (no sharing in dev): lifecycle, spa                 | pass |
| No console errors, no `Invalid hook call`, no minified React error, no "unmount a root while React was already rendering" | pass |

## Measurements (JS per remote origin, gzip, Node `zlib` default level)

Spike baseline: ~76 KB gzip (242 KB raw, 3 files) per distinct remote.

| Page                          | Origin             | Files | Raw      | Gzip        |
| ----------------------------- | ------------------ | ----- | -------- | ----------- |
| unshared, `remotes=a`         | a (6100)           | 4     | 239.2 KB | **75.4 KB** (77 182 B) |
| unshared, `remotes=a,b`       | b (6101)           | 4     | 239.2 KB | 75.4 KB (77 183 B) |
| unshared, `remotes=a,c`       | c (6104)           | 4     | 239.0 KB | 75.3 KB (77 092 B) |
| shared, `remotes=a`           | a                  | 13    | 273.8 KB | **88.5 KB** (90 635 B) |
| shared, `remotes=a,b`         | a (first)          | 13    | 273.8 KB | 88.5 KB (90 635 B) |
| shared, `remotes=a,b`         | b (second, same React) | 9 | 58.9 KB  | **20.9 KB** (21 450 B) |
| shared, `remotes=a,c`         | c (mismatched React) | 13  | 273.6 KB | **88.4 KB** (90 551 B) |

- **Second same-React remote:** 20.9 KB, against an expectation of ≤ 30 KB. It saves **54.5 KB** against
  the same remote unshared. The PASS threshold is ≥ 40 KB.
- **Whole page, two same-React remotes:** 109.4 KB shared against 150.8 KB unshared, a net saving of
  41.4 KB.
- **First remote and mismatched remote:** 88.5 KB and 88.4 KB, against an expectation of ≤ 84 KB.
  **Both miss it by about 4.5 KB.** The share layer costs 13.1 KB per first or mismatched remote:
  - MF runtime: about 11.3 KB gzip, even with `FEDERATION_OPTIMIZE_NO_REMOTE` and
    `FEDERATION_OPTIMIZE_NO_SNAPSHOT_PLUGIN`. Without those flags it was 22.8 KB.
  - Splitting the bundle into separate chunks: about 2 KB.

  Task 18B should get this back. Options: a smaller share runtime (MF `runtime-core` alone, or a
  scope reader of about 1 KB that keeps the MF `__FEDERATION__.__SHARE__` shape), or merging the
  small stub chunks.

## Task 18B: the shipped mechanism and its cost

Task 18B moved the mechanism into the library (`share` option of `@next-federation/vite`, on by
default for builds). It is the 18A mechanism without the Module Federation runtime: a hand-written
scope reader of about 1 KB (`initIslandShareScope`, `@next-federation/island/share-scope`). It keeps
MF's entry shape (`singleton: false`, `strictVersion`, exact `requiredVersion`, `loaded-first`), under
`__FEDERATION__.__SHARE__['@next-federation/island-share@1']['nf-islands']`. The bundled copies sit
in one lazy `react-<hash>.js` chunk.

Measured 2026-11-16, lane `b`, the same method as above (`NF_MEASURE=1`, gzip of every JS file per
remote origin, no probe in the build):

| Page | Origin | Files | Gzip bytes | Against unshared |
| --- | --- | --- | --- | --- |
| unshared (`share: false`), `remotes=a` | a | 4 | 77 183 | (baseline) |
| unshared, `remotes=a,c` | c (React 19.3.0) | 4 | 77 092 | (baseline) |
| shared, `remotes=a` (first remote) | a | 9 | 79 843 | **+2 660** |
| shared, `remotes=a,b` | b (second, same React) | 8 | 12 059 | **−65 125** |
| shared, `remotes=a,c` | c (mismatch fallback) | 9 | 79 739 | +2 647 |
| shared, `remotes=a,b&host=1` (host provides React) | a / b | 8 / 8 | 12 082 / 12 059 | −65 101 / −65 125 |

- The share layer costs a first or mismatched remote +2.6 KB. The budget is +8 KB; 18A measured
  +13.1 KB with the MF runtime.
- The second same-React remote saves 63.6 KB. The gate threshold is ≥ 40 KB.
- Whole page, two same-React remotes: 91 902 B shared against 154 367 B unshared, a 61.0 KB saving.

## Mechanism

Fixture-only: `test/fixtures/island-remote/share-proof.ts`, on when `NF_SHARE=1`. It applies to the
`client` environment of production builds only.

1. **An async boundary at the bootstrap.** The remote's client entry (the module an envelope's
   `bootstrap` names) becomes:
   `await init(); const real = await import('<entry>?nf-share-real'); export const mountIsland = real.mountIsland`.
   As a result, every module that imports React runs after the share scope is ready.
2. **`init()` sets up one MF runtime instance per build** (`createInstance`, name
   `nf-islands:<publicBase>`, `shareStrategy: 'loaded-first'`):
   - It attaches the page-wide scope object `__FEDERATION__.__SHARE__['nf-islands']['nf-islands']`
     with `initShareScopeMap`.
   - It then `loadShare`s `react`, `react-dom`, `react-dom/client` and `react/jsx-runtime`, in that
     order.
   - Each package is registered with `version` = the installed version, `strictVersion: true`,
     `requiredVersion` = that exact version, `strategy: 'loaded-first'`, and
     `get: () => import(<local provider>)`.
3. **Bare imports of the four specifiers become CommonJS stubs:**
   `module.exports = require('virtual:nf-share/init').get('<name>')`. They cover imports from
   island code, `@next-federation/island`, `react-server-dom-webpack/client.browser`, and React's
   own `react-dom` → `react` requires. React's CJS code therefore gets the very same object.
4. **The bundled copies sit behind lazy "local provider" chunks**, named `react-*.js`,
   `react-dom-*.js`, `react-dom-client-*.js` and `react-jsx-runtime-*.js` (ruling 9). Only the
   build that provides a version downloads them.
5. **The flight client is not shared.** `react-server-dom-webpack/client.browser` stays in each
   build's entry chunk and still goes through `scopeFlightClient`, keeping its per-build `__nf_rsc__`
   slot. Its `react` and `react-dom` imports resolve to the shared modules.
6. **Probe (ruling 8):** each React copy that evaluates increments `window.__proofReactCopies` and
   pushes its version onto `window.__proofReactVersions`. Task 18's `^__nf` globals filter is
   unchanged and still passes.
7. **The old-React remote `c`** (`test/fixtures/island-remote-old-react`, port 4104) builds the
   island-remote sources (root `../island-remote`).
   - It resolves `react`, `react-dom` and `react-server-dom-webpack`, with subpaths, from its own
     `node_modules` (19.3.0) in every environment. It does this with a re-resolving plugin, not
     path aliases, so export conditions such as `react-server` still apply (ruling 7).
   - The page asserts that version in two places: the server side through the envelope's
     `reactVersion`, and the browser side through the probe.
   - Until the gate's follow-up decides, `c` stays out of the pnpm workspace (ruling 31). Install it
     with `pnpm install --ignore-workspace` in that folder.

**Host-provided React (fixture stand-in for 18B):** `/shared?host=1` writes the host's own React
modules into the same scope as loaded entries before any island loads.

## What broke

### Mechanism 1: `@module-federation/vite` 1.24.0 on the client environment only

It failed. Restricting its plugins to `client` with `applyToEnvironment` is not enough:

1. **Its `buildApp` hook rewrites `entryFileNames` and `chunkFileNames` in every environment.** As a
   result, plugin-rsc's `rsc/index.js` and `ssr/index.js` land in `assets/`, and `nf-serve` cannot
   start (`ERR_MODULE_NOT_FOUND …/rsc/index.js`). An `outputOptions` override for the server
   environments works around this.
2. **It wraps the bootstrap entry for `hostInit` and drops its export.** Every island goes inert with
   `NF-011 … TypeError: i.mountIsland is not a function`.
3. **It emits `remoteEntry-*.js` outside `client/assets/`.** `nf-serve` does not serve that path with
   CORS, so the host page cannot load it (`blocked by CORS policy`).
4. **Its model is host/remote.** Two peer builds (two MF "hosts") each get their own instance and
   share only if they use one global name. An island remote has no `remoteEntry` to exchange.

Fixing 2 and 3 means working against the plugin's internals. That is not a basis for 18B.

### `singleton: true`, the brief's value

Mechanism 2 with `NF_SHARE_SINGLETON=1` fails "load order: c first". MF singleton semantics pick one
version per scope and throw on a mismatch, even with `loaded-first`. Once `c` loaded 19.3.0, both `a`
and `b` got the error `Version 19.3.0 … of shared singleton module react does not satisfy … 19.3.1`
and fell back to their own copies, so there were 3 copies instead of 2.

The design wants one instance per exact version with an own-copy fallback. In MF terms that is
`singleton: false` with `strictVersion: true` and an exact `requiredVersion`:
- The scope keeps one entry per version.
- Every build that requires that version gets the same loaded instance.
- A build with no matching version registers and loads its own copy.

The gate runs with this setting.

## Carried risks

- **(a) A root destroyed inside the host's effect.** Checked in two set-ups: swap and toggle 10×
  with `a` and `b` sharing one React, and the same with the host providing its React. In the second
  set-up the island roots and the host's effect run on the same React.
  - Results: no console error and no warning; live roots stayed at 2 and counters still work.
  - **Caveat:** production React strips the "unmount a root while React was already rendering"
    message, and sharing exists only in production builds. This is functional evidence, not proof
    that the warning never appears.
  - Task 18B, if it offers host-provided React, should defer `destroy()` (for example
    `queueMicrotask`) when the island root shares the host's React.
- **(b) Task 16's hydration signal and the double-root guard.** Lifecycle passes with `NF_SHARE=1`:
  StrictMode hydrates once, the swap re-bootstraps, rapid toggle and toggle during bootstrap pass.
  Repeated 3× together with `sharing`: 45/45 passed.
- **(c) Existing specs.** lifecycle, spa and protocol-endpoint pass under prod and `--webpack`, the
  skew suite passes with sharing, and dev passes without it.

## Reproduce

```bash
cd test/fixtures/island-remote-old-react && pnpm install --ignore-workspace && cd -
export NF_LANE=b
NF_APPS=remote-a,remote-b,remote-c,host-spa NF_SHARE=1 pnpm e2e:prod -- sharing
NF_APPS=remote-a,remote-b,remote-c,host-spa NF_SHARE=1 pnpm e2e:prod:webpack -- sharing
NF_APPS=issuer,fake-remote,remote-a,remote-b,remote-c,host-spa NF_SHARE=1 pnpm e2e:prod -- lifecycle spa protocol-endpoint
NF_APPS=issuer,fake-remote,remote-a,remote-b,remote-c,remote-a-retired,host-spa NF_SHARE=1 pnpm e2e:skew -- sharing skew lifecycle spa protocol-endpoint
NF_APPS=issuer,fake-remote,remote-a,remote-b,host-spa pnpm e2e:dev -- lifecycle spa
NF_APPS=remote-a,remote-b,remote-c,host-spa NF_SHARE=1 NF_MEASURE=1 pnpm e2e:prod -- sharing -g measure
NF_APPS=remote-a,remote-b,remote-c,host-spa NF_MEASURE=1 pnpm e2e:prod -- sharing -g measure   # unshared
```

Mechanism 1: `NF_SHARE_MECH=mf-vite`. Probe only, with no sharing (the red run): `NF_SHARE_MECH=probe`.
