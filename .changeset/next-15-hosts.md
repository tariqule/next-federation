---
'@next-federation/next': minor
'@next-federation/sdk': minor
---

Next.js 15 hosts are supported: the `next` peer range is now `>=15.5.28 <17`. Islands and remote components work on Next 15 (React 19) in the App Router and the Pages Router, with Turbopack or webpack, through the legacy caching model (fetch `revalidate` and tags). `cacheComponents` stays Next 16 only: with Next 15 installed, `withNextFederation` fails with `NF-002` when `cacheComponents`, `experimental.cacheComponents` or `experimental.dynamicIO` is on. The wrapper reads the installed Next.js from the folder of the calling `next.config` (when it holds one) and from the working directory, and fails with `NF-002` when the two have different Next majors (`next build apps/web` run from a monorepo root on another Next). New `NF-037`: under `next dev`, a private island warns once when React's development debug info may carry its values to the browser: the library linked from outside `node_modules`, or `next dev --disable-source-maps`. Installed packages with Next's default dev source maps, and production builds, are not affected. Next 14 is not supported.
