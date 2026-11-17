---
'@next-federation/core': minor
'@next-federation/server': patch
'@next-federation/vite': patch
'@next-federation/next': patch
---

Follow-ups to Server Actions and Next.js 15 support.

- `fetchIsland` reads at most `maxBytes` of an island response (5 MiB by default, `MAX_ENVELOPE_BYTES`) and cancels the rest; a larger body fails with `NF-007`, is not retried, and the island renders its fallback. Set it with `islands.maxBytes` or per remote with `remotes.<name>.maxBytes` in `defineFederation`. `meta.bytes` now counts bytes, not characters. With `cacheComponents`, the island target is part of the island's `'use cache'` key and now carries `maxBytes`, so every cached public island envelope misses once after upgrading (one fetch per island, then cached as before).
- `toNodeListener` (and so `nf-serve`): a request body the handler is still reading when the response finishes is errored, so the pending read settles instead of waiting forever.
- `NF-035` no longer warns for a `formAction` button written inside `<Form>` (the island's `Form`, under any local name); a raw `<form action={...}>` still warns.
- The dev Server Action allowlist matches files outside the root on Windows (`/@fs/C:/...` ids, either drive-letter case).
- `withNextFederation` decides whether `cacheComponents` is available from the installed Next.js major (16 and later) instead of loading `next/cache` at config time, and reads the `next.config` folder from Windows stack frames (`C:\...` paths and `file:///C:/...` URLs).
- `nf-types`: when a remote's current (verified) build publishes no types, its previously synced folder and `index.d.ts` entry are removed instead of being kept as stale types.
