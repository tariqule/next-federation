---
'@next-federation/sdk': minor
'@next-federation/protocol': minor
'@next-federation/react': minor
'@next-federation/server': minor
'@next-federation/island': minor
'@next-federation/vite': minor
'@next-federation/next': minor
---

Island Server Actions.

- An island's `'use server'` functions post straight to the remote build that rendered it (`POST <base>_nf/action`, protocol v1 "Server Actions"), with the island's bearer token and never cookies. Each mount has its own action client; a rejected token is refreshed and the call resent once.
- `<Form>` (`@next-federation/island`) keeps island forms disabled until hydration. `requireIdentity(fn)` and the Vite option `actions: { requireIdentity: true }` refuse unauthenticated actions.
- Public islands on Next.js hosts with `getIdentity` run their actions as the signed-in user while the page stays static.
- `nf-serve` answers its own 413/502/504 with CORS and gives `/_nf/action` a separate 8 MiB ceiling.
- `toNodeListener` (and so `nf-serve`'s build processes) drains a request body the handler answered without reading to the end, so the next request on that keep-alive connection is not left waiting.
- Type change: the exported `IslandProps` type (`@next-federation/next/pages`, `@next-federation/next/pages/server`) and its island token type widen `token.identityKey` to `string | null` (`null`: a public island on a host with `getIdentity`, whose actions fetch a token for whoever is signed in when they run). Code that reads `identityKey` as a `string` must handle `null`.
- New error codes NF-031 to NF-035. NF-019 now only comes from remotes built before this release.
