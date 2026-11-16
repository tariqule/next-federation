---
'@next-federation/sdk': minor
'@next-federation/protocol': minor
'@next-federation/core': minor
'@next-federation/react': minor
'@next-federation/server': minor
'@next-federation/island': minor
'@next-federation/vite': minor
'@next-federation/next': minor
---

Next.js 16 and SPA adapters for both federation modes.

- RSC islands: `@next-federation/next` for the App Router (legacy caching and `cacheComponents`) and the Pages Router (`getIslandProps`, `RemoteIsland`), `@next-federation/vite` for island remotes, `@next-federation/server` with `nf-serve` build retention, per-user islands with ES256 identity tokens, and React shared between same-version island remotes.
- Module Federation client components (Mode A): `createRemoteComponent` (`@next-federation/react/components`) loads a remote's client component through the Module Federation runtime into the host's React tree. Next.js hosts server-render it once the remote's server build is verified (a signed descriptor or pinned digests); otherwise it renders in the browser.
- New error codes NF-026 to NF-030.
