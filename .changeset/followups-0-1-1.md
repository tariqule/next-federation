---
'@next-federation/next': patch
'@next-federation/react': patch
'@next-federation/island': patch
'@next-federation/vite': patch
---

Fixes from the 0.1.0 reviews:

- `@next-federation/next`: a components descriptor read inside the host's own `'use cache'` component, before this process loaded the build (NF-039), now gives that scope the failure profile (still static, regenerated within seconds) instead of a dynamic hole that could leave the page stuck as a partial prerender.
- `@next-federation/next`: without `cacheComponents`, the stale-if-error age of an island is measured from when its envelope was fetched (the response's `Date`), not from the render that read it from Next's fetch cache.
- `@next-federation/next`: the last good envelopes count their keys (which hold the props) against the 50 MiB budget.
- `@next-federation/next`: an island the remote no longer exposes (its JSON `404`, `NF-021`) is no longer served from its last good envelope; the fallback renders at once.
- `@next-federation/island`: `actions.timeoutMs` is one deadline across a token refresh and its retry, never twice the limit.
- `@next-federation/vite`: the components dev server no longer warns about a page when a browser tab opens `/mf-manifest.json`, the descriptor or another file.
- `@next-federation/react`: a remote component's fallback that uses `useId` gets the same id on the server and in the browser after a server render error.
