---
'@next-federation/vite': patch
'@next-federation/sdk': patch
---

Security: `@next-federation/vite` no longer accepts a `react-server-dom-webpack` affected by [GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3) (unauthenticated remote code execution in React Server Components). The optional peer range is now `~19.0.9 || ~19.1.10 || ~19.2.9 || >=19.3.1 <20`, which excludes 19.0.0 to 19.0.8, 19.1.0 to 19.1.9, 19.2.0 to 19.2.8 and 19.3.0. An island remote's production build refuses an affected copy with the new `NF-041`, naming the version found and the first patched version of its minor line; the Vite dev server logs `NF-041` as a warning. When `react-server-dom-webpack` is missing on an affected React, the `NF-002` install command now names the patched version for `react`, `react-dom` and `react-server-dom-webpack`.
