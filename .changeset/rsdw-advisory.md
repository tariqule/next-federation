---
'@next-federation/vite': patch
'@next-federation/server': patch
'@next-federation/protocol': patch
'@next-federation/sdk': patch
---

Security: refuse a `react-server-dom-webpack` affected by [GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3) (unauthenticated remote code execution in React Server Components).

- `@next-federation/vite`: the optional peer range is now `~19.0.9 || ~19.1.10 || ~19.2.9 || >=19.3.1 <20`, which excludes 19.0.0 to 19.0.8, 19.1.0 to 19.1.9, 19.2.0 to 19.2.8 and 19.3.0. An island remote's production build refuses an affected copy with the new `NF-041`, naming the version found and the first patched version of its minor line. It checks every copy the build may use, including the one next to `@vitejs/plugin-rsc` (which the server bundle gets when plugin-rsc is hoisted in npm or yarn workspaces). Experimental React builds (`0.0.0-*`) and every `19.3.0-canary-*` are refused too, since they cannot be checked against the advisory: use a patched stable release. The Vite dev server only warns. `nf-build.json` records the versions a build used (`reactServerDomWebpack`). When `react-server-dom-webpack` is missing on an affected React, the `NF-002` install command names the patched version.
- `@next-federation/server`: `nf-serve` refuses a build whose `nf-build.json` records an affected or experimental version, or whose `reactServerDomWebpack` field is malformed or empty (`NF-041`). It does not start when that is the current build; an older build is retired (`410 NF-023`). Builds that record no version (an older `@next-federation/vite`) are served and logged once as an `NF-041` error.
- `@next-federation/protocol`: `checkFlightClientVersion`, `flightClientAdvisoryDetail` and `RSC_ADVISORY`, the advisory table both share.

**After upgrading, remove every build made with an affected version.** Upgrading and redeploying is not enough: `nf-serve` keeps the newest 3 builds (and any build under 24 hours old) running, each answering `/b/<build>/_nf/*`, Server Actions included, and Vercel keeps earlier deployments. Delete those build folders from the `nf-serve --dir` folder and restart it (or restart once with `--max-builds 1 --min-age-hours 0`); on Vercel, delete those deployments, and keep them behind Deployment Protection until then. Steps: `docs/errors/vulnerable-react-server-dom.md`.
