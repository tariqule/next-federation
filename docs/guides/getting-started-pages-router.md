# Getting started: Next.js Pages Router host

This guide embeds an island from a remote app in a Next.js 16 Pages Router page. It covers the host
only. To build the remote, see [Writing an island remote](writing-an-island-remote.md).

Supported: Next.js 16 (`>=16.0.0 <17`), React 19, Turbopack or webpack, Node 20.9 or newer.

## Choosing between remote components and islands

This guide sets up islands. A remote can also ship remote components, and a host can use both.

| | Remote components | Islands |
| --- | --- | --- |
| What the remote ships | A client component module | Server-rendered HTML from its own server |
| React | The host's | The remote's own |
| Host context and router | Readable; `next/link` and the router come from the host | Do not cross in; pass data as props |
| Props | Anything a client component takes | Plain JSON |
| Server rendering | On the host, for signed or pinned builds | Always, on the remote |
| Remote code on the host's server | Yes, for verified builds | Never |
| Choose it for | Interactive pieces that must feel native: menus, carts, widgets in a client-heavy app | Server-rendered content the remote owns: product pages, data the remote fetches with its secrets |

Remote components: see [Remote components](remote-components.md).

## 1. Install

```sh
pnpm add @next-federation/core @next-federation/next @next-federation/react react react-dom
```

## 2. Wrap `next.config.ts`

```ts
// next.config.ts
import { withNextFederation } from '@next-federation/next/config'

export default withNextFederation({
  // your Next config, including basePath and i18n
})
```

`basePath` and the locale are sent to the remote, so island links render with the right prefix.

## 3. Define the federation (server-side only)

Import this file only from `getServerSideProps`, `getStaticProps` and API routes.

```ts
// lib/federation.ts
import { defineFederation } from '@next-federation/core'
import { createPagesIslands } from '@next-federation/next/pages/server'

export const federation = defineFederation({
  remotes: { shop: { origin: 'https://shop.example.com' } },
})

export const { getIslandProps } = createPagesIslands(federation)
```

## 4. Render an island

```tsx
// pages/product.tsx
import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

type Props = { cart: IslandProps }

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => ({
  props: {
    cart: await getIslandProps(ctx, { remote: 'shop', island: 'Cart', props: { sku: 'A1' } }),
  },
})

export default function Product({ cart }: Props) {
  return <RemoteIsland {...cart} fallback={<p>Cart unavailable</p>} />
}
```

`getIslandProps` never throws for a remote failure. It returns `envelope: null`, and `RemoteIsland`
renders `errorFallback ?? fallback`. It throws for caller mistakes: `NF-001` (unknown remote),
`NF-009` (props not JSON), `NF-017` (missing `withNextFederation`).

## Static pages

In `getStaticProps` the page's own `revalidate` is the island cache. A remote failure is baked into the
page for that window, so retry sooner when the envelope is missing:

```ts
export const getStaticProps: GetStaticProps<Props> = async (ctx) => {
  const banner = await getIslandProps(ctx, { remote: 'shop', island: 'Banner' })
  return { props: { banner }, revalidate: banner.envelope ? 60 : 1 }
}
```

## Per-user islands

Private islands work in `getServerSideProps` only. Calling `getIslandProps` with `private: true` from
`getStaticProps` throws `NF-002` (there is no request to read the user from). See [Identity](identity.md).

## Share the host's React (optional)

In `pages/_app.tsx`, at module scope, call `provideHostReact()` from `@next-federation/react/share` so
islands built on the same exact stable React version download no React of their own. It does nothing
in development or on a React pre-release. See [Limits](limits.md) for what it saves.

## What to know

- Add each remote origin to `script-src`, `connect-src` and `style-src` ([CSP](csp.md)).
- Island HTML is stored about three times in the page. React context does not cross into an island.
- Remote components (client components, with SSR): see [Remote components](remote-components.md).

Related: [Caching](caching.md), [Deployment](deployment.md), [Limits](limits.md).
