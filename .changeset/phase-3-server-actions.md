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
- New error codes NF-031 to NF-035. NF-019 now only comes from remotes built before this release.
