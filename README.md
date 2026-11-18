# next-federation

**Documentation: <https://next-federation-docs.vercel.app>**

**Live demo: <https://next-federation-example-app-router.vercel.app>** (the
[examples](examples/README.md#live-demo) on Vercel: three hosts, two remotes)

Runtime UI federation for Next.js. A remote app, deployed on its own, provides UI that your host app
renders at runtime, with no rebuild of the host when the remote deploys. It supports the Next.js App
Router and Pages Router (Turbopack or webpack) and client-side React hosts, and remotes built with
Vite. It uses public Next.js APIs only, so a Next.js upgrade does not break it.

There are two ways to embed a remote's UI:

- **Islands**: the remote renders real React Server Components on its own server, and your host
  embeds the result as a server-rendered, hydrated island.
- **Remote components**: the remote ships a client component as a Module Federation 2.0 module. Your
  host loads it through the Module Federation runtime and renders it inside its own React tree, where
  it shares the host's context and router. Verified builds are server-rendered.

## Who it is for

Use it when separate teams deploy parts of one product on their own schedules, and the host page
needs to show UI that the host's team does not build: a checkout owned by another team, a catalog
panel with its own data, a widget that must feel like part of the app.

It is not a fit if you need route-level splitting (use multi-zones or `@vercel/microfrontends`), CSS
isolation (there is no Shadow DOM), Next.js 14 or React 18, non-React frameworks, or the Edge runtime
in the host. [Limits](docs/guides/limits.md) lists what islands cannot do and what they cost.
[Architecture](docs/architecture.md) explains how it works.

## Islands

The host renders an island with one component:

```tsx
// app/page.tsx (App Router host)
import { RemoteIsland } from '../lib/federation'

export default function Page() {
  return <RemoteIsland remote="shop" island="ProductPanel" props={{ sku: 'A1' }} fallback={<p>Loading…</p>} />
}
```

The remote declares its islands in its Vite config:

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

## Remote components

The remote exposes a client component:

```ts
// vite.config.ts (components remote)
import { nextFederationComponents } from '@next-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    nextFederationComponents({
      name: 'cart',
      base: 'https://cart.example.com/',
      exposes: { './CartButton': './src/CartButton.tsx' },
    }),
  ],
})
```

The host binds it once, then renders it with the remote's descriptor:

```tsx
// lib/CartButton.tsx (host, a client file)
'use client'
import { createRemoteComponent } from '@next-federation/react/components'

export const CartButton = createRemoteComponent<{ sku: string }>({
  expose: './CartButton',
  fallback: <p>Loading…</p>,
})
```

```tsx
// lib/RemoteCartButton.tsx (host, a Server Component)
import { getComponentDescriptor } from '@next-federation/next/server'
import { CartButton } from './CartButton'
import { federation } from './federation'

export async function RemoteCartButton({ sku }: { sku: string }) {
  const descriptor = await getComponentDescriptor(federation, 'cart')
  return <CartButton descriptor={descriptor} sku={sku} />
}
```

## Install

For a Next.js host:

```sh
pnpm add @next-federation/core @next-federation/next @next-federation/react
```

For a remote built with Vite, add `@next-federation/vite` and `@next-federation/server` as dev
dependencies. Each [getting-started guide](#getting-started) lists the exact packages for its setup
and how to pin React.

## Getting started

Pick the guide for what you are building:

| You are building                        | Guide                                                               | Example                                         |
| --------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| A Next.js App Router host               | [App Router](docs/guides/getting-started-app-router.md)             | [next-app-router](examples/next-app-router)     |
| A Next.js Pages Router host             | [Pages Router](docs/guides/getting-started-pages-router.md)         | [next-pages-router](examples/next-pages-router) |
| A client-side React host (Vite SPA)     | [SPA](docs/guides/getting-started-spa.md)                           | [react-spa](examples/react-spa)                 |
| A remote that serves islands            | [Writing an island remote](docs/guides/writing-an-island-remote.md) | [vite-remote](examples/vite-remote)             |
| A remote that exposes client components | [Remote components](docs/guides/remote-components.md)               | [components-remote](examples/components-remote) |

To run every example together, run `pnpm examples:dev` in a checkout of this repository. See
[examples/README.md](examples/README.md).

## Documentation

The [docs index](docs/README.md) lists every guide. A few places to start:

- [Architecture](docs/architecture.md): how islands and remote components work, and what a host trusts
- [Identity](docs/guides/identity.md): private islands and key rotation
- [Caching](docs/guides/caching.md): islands with static pages, ISR and `cacheComponents`
- [Deployment](docs/guides/deployment.md): serving remotes, skew and build retention
- [Island protocol v1](docs/protocol/v1.md): the wire contract
- [Error codes](docs/README.md#errors): every `NF-0xx` code has a page that says what to do

## Packages

| Package                                          | Purpose                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [`@next-federation/sdk`](packages/sdk)           | Error codes and the category logger                                                   |
| [`@next-federation/protocol`](packages/protocol) | Island protocol v1: envelope, request codec, bootstrap types                          |
| [`@next-federation/core`](packages/core)         | `defineFederation`, `fetchIsland`, identity tokens, remote component descriptors      |
| [`@next-federation/react`](packages/react)       | `IslandMount`, `FederationErrorBoundary`, remote components (`createRemoteComponent`) |
| [`@next-federation/server`](packages/server)     | Island request handler, identity verifier, `nf-serve`                                 |
| [`@next-federation/island`](packages/island)     | Remote-side runtime: `Link`, `Form`, `getIdentity`, browser bootstrap                 |
| [`@next-federation/vite`](packages/vite)         | Vite 8 plugins that build an island remote or a components remote                     |
| [`@next-federation/next`](packages/next)         | Next.js adapter: `withNextFederation`, `RemoteIsland`, JWKS and token routes          |

## Status and compatibility

`next-federation` is at 0.x, so the API can still change between minor versions. Pin the version and
read the changelogs. All packages are versioned together.

|         | Supported                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| React   | 19 (required)                                                                                                          |
| Next.js | 16 and 15 (`>=15.5.28 <17`); `cacheComponents` is Next.js 16 only                                                      |
| Node.js | 20.9 or newer. Server rendering of remote components needs 20.16 or newer; older Node renders them in the browser only |
| Remotes | Vite 8. Remote components can also come from Rspack or webpack with Module Federation 2.0                              |

The tests run on React and React DOM 19.3.1 (`react-server-dom-webpack` 19.3.1 in island remotes),
plus one island remote on 19.3.0 to cover mixed versions. Other React 19 versions are not covered.
Scaffolds move on: at the time of writing `create-vite` writes a caret range (`"react": "^19.3.1"`) and
`create-next-app` writes `19.3.0`. Pin `react` and `react-dom` to the same exact version in the host
and in each remote (`"react": "19.3.1"`, no `^`), and pin `react-server-dom-webpack` the same way in
an island remote. `pnpm add --save-exact react@19.3.1` does not remove a caret that is already in
`package.json`, so open `package.json` after you scaffold a project and after you pin, and edit the
range by hand if it still has a `^`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). [AGENTS.md](AGENTS.md) has the repo map, the commands and
the rules every change must keep. Report a vulnerability through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). `next-federation` is a community project and is not affiliated with or endorsed by
Vercel. Next.js is a trademark of Vercel, Inc.
