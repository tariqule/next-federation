# Module Federation Vite: one `__mf_init__` global per loaded build

Maintainer note. Read it when you bump `@module-federation/vite` (pinned in
`packages/vite`) or change how the host server loads remote components.

The server-side loader for remote components evaluates a remote's server build inside the host
process. Remote code built with `@module-federation/vite` leaves one `globalThis.__mf_init__...` key
per distinct build and writes shared modules into a process-wide `__mf_module_cache__`. This note
records what we observed and how the library works around it. The rest of the page is the text of an
upstream issue we may file against `module-federation/vite` (version 1.24.0); it has not been filed.

## Issue title

SSR: every distinct remote build loaded into a long-running server adds a `globalThis` key that is never removed

## Issue body

**Setup.** A host server (Node) loads many builds of the same remote over its lifetime (each deploy
of the remote is a new build under its own URL). The remote is built with `@module-federation/vite`
1.24.0 with an SSR environment (`output.format: 'cjs'`), and the host evaluates the remote's
`remoteEntry.ssr.js` graph per build, then drops every reference to the old build.

**What happens.** The old build's modules are garbage-collected (we measured 499 of 500 module
instances collected over 500 loads cycling 20 builds), but each distinct build leaves one global
behind. Every server chunk that loads a shared module contains:

```js
var __mfPromiseGlobalKey = "__mf_init__virtual:mf:__mfe_internal__<name>__mf_owner__<hash>__mf_v__runtimeInit__mf_v__.js__";
var __mfPromiseState = globalThis[__mfPromiseGlobalKey];
if (!__mfPromiseState) {
  __mfPromiseState = globalThis[__mfPromiseGlobalKey] = { initPromise, initResolve, initReject };
}
```

`<hash>` differs per build, so 20 builds give 20 keys; reloading the same builds adds none. Each key
holds a settled promise and its resolve/reject functions, and through their closures whatever
the init promise resolved with, so the leak per build is small but unbounded in a process that
keeps receiving deploys.

**Related.** The SSR entry also writes `globalThis.__mf_module_cache__.share[pkg] ??= module`
(first writer wins). In a process with two React copies (for example a Next.js host with App Router
and Pages Router routes, which use different React builds) every remote gets the first React that
registered, which is wrong for the other one.

**Ask.**

1. Scope the init state to the remote container instance (or key it by the container name only,
   and replace it on re-init), so a new build of a remote replaces the old build's state instead of
   adding a key; or expose a documented way to release a build (for example `dispose()` on the
   container that deletes its keys).
2. Let the host scope the module cache: read it from the `shared` argument passed to `init()` (the
   code already checks `shared?.[moduleCacheKey]` first) and document it, so a host with two
   share scopes can give each its own cache.

**Workaround in next-federation.** The host caps the number of distinct builds a process loads
(default 5 per remote, oldest evicted) and documents the residual key per build. Renders whose
React is not the one in the process-wide share cache fall back to browser-only rendering.
