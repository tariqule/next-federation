# next-federation

[![npm](https://img.shields.io/npm/v/@next-federation/next?label=npm)](https://www.npmjs.com/package/@next-federation/next)
[![GitHub release](https://img.shields.io/github/v/release/tariqule/next-federation)](https://github.com/tariqule/next-federation/releases)
[![CI](https://github.com/tariqule/next-federation/actions/workflows/ci.yml/badge.svg)](https://github.com/tariqule/next-federation/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/tariqule/next-federation/badge)](https://scorecard.dev/viewer/?uri=github.com/tariqule/next-federation)

Runtime UI federation for Next.js. A remote app, deployed on its own, provides UI that your host renders at runtime, with no host rebuild.

- **Documentation:** <https://next-federation-docs.vercel.app>
- **Live demo:** <https://next-federation-docs.vercel.app/docs/live-demo>

It supports the App Router and Pages Router (Turbopack or webpack), client-side React hosts, and remotes built with Vite. It uses only public Next.js APIs.

Two ways to embed a remote's UI:

- **Islands**: the remote renders React Server Components on its own server, and your host embeds the result, hydrated.
- **Remote components**: the remote ships a client component as a Module Federation 2.0 module, rendered in your host's React tree.

## Quickstart

Install in a Next.js host:

```sh
pnpm add @next-federation/core @next-federation/next @next-federation/react
```

Render an island:

```tsx
// app/page.tsx (App Router host)
import { RemoteIsland } from '../lib/federation'

export default function Page() {
  return <RemoteIsland remote="shop" island="ProductPanel" props={{ sku: 'A1' }} fallback={<p>Loading…</p>} />
}
```

Declare it in the remote's Vite config:

```ts
// vite.config.ts (island remote)
import { nextFederationIslands } from '@next-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: nextFederationIslands({
    name: 'shop',
    base: 'https://shop.example.com/',
    hosts: ['https://www.example.com'],
    islands: { ProductPanel: './src/islands/ProductPanel.tsx' },
  }),
})
```

The [App Router guide](docs/guides/getting-started-app-router.mdx) has the full setup.

## Documentation

| You are building                        | Start here                                                           | Example                                         |
| --------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| A Next.js App Router host               | [App Router](docs/guides/getting-started-app-router.mdx)             | [next-app-router](examples/next-app-router)     |
| A Next.js Pages Router host             | [Pages Router](docs/guides/getting-started-pages-router.mdx)         | [next-pages-router](examples/next-pages-router) |
| A client-side React host (Vite SPA)     | [SPA](docs/guides/getting-started-spa.mdx)                           | [react-spa](examples/react-spa)                 |
| A remote that serves islands            | [Writing an island remote](docs/guides/writing-an-island-remote.mdx) | [vite-remote](examples/vite-remote)             |
| A remote that exposes client components | [Remote components](docs/guides/remote-components/overview.mdx)      | [components-remote](examples/components-remote) |

More: [Caching](docs/guides/caching.mdx), [Identity](docs/guides/identity.mdx), [Deployment](docs/guides/deployment.mdx), [Limits](docs/guides/limits.mdx), [Architecture](docs/architecture.mdx), [Island protocol v1](docs/protocol/v1.md), [Error codes](docs/errors/index.mdx) and the [docs index](docs/index.mdx).

`pnpm examples:dev` starts every [example](examples/README.md). For a larger setup, see the [commerce platform](examples/advanced/README.md).

## Packages

| Package                                          | Purpose                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| [`@next-federation/sdk`](packages/sdk)           | Error codes and logger                                                 |
| [`@next-federation/protocol`](packages/protocol) | Island protocol v1 types and codec                                     |
| [`@next-federation/core`](packages/core)         | `defineFederation`, `fetchIsland`, identity tokens, descriptors        |
| [`@next-federation/react`](packages/react)       | `IslandMount`, `FederationErrorBoundary`, `createRemoteComponent`      |
| [`@next-federation/server`](packages/server)     | Island handler, identity verifier, `nf-serve`                          |
| [`@next-federation/island`](packages/island)     | Remote-side runtime: `Link`, `Form`, `getIdentity`                     |
| [`@next-federation/router`](packages/router)     | Internal router runtime; Rspack build helpers (`/build`)               |
| [`@next-federation/vite`](packages/vite)         | Vite 8 plugins for island and components remotes                       |
| [`@next-federation/next`](packages/next)         | Next.js adapter: `withNextFederation`, `RemoteIsland`, identity routes |

## Status and compatibility

At 0.x the API can change between minor versions. Pin the version. All packages are versioned together.

|         | Supported                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React   | Host: 19 (App Router); 18.3 or 19 (Next 15 Pages Router, Vite SPA). Island remote: React 19 with patched `react-server-dom-webpack` (19.0.9, 19.1.10, 19.2.9, 19.3.1 or later) |
| Next.js | `>=15.5.28 <17`. `cacheComponents` needs 16. Not 14                                                                                                                            |
| Node.js | 20.9 or newer. A Vite remote needs 20.19+ or 22.12+                                                                                                                            |
| Remotes | Vite 8. Remote components also from Rspack (tested) or webpack (untested)                                                                                                      |

Pin `react` and `react-dom` to the same exact version in host and remotes, with no `^`. See [Limits](docs/guides/limits.mdx).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). `next-federation` is a community project and is not affiliated with or endorsed by Vercel. Next.js is a trademark of Vercel, Inc.
