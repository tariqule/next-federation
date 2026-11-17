# Getting started: Next.js App Router host

This guide embeds an island from a remote app in a Next.js 16 App Router page. It covers the host
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

The wrapper is required. Adapter entry points fail with `NF-017` without it.

```ts
// next.config.ts
import { withNextFederation } from '@next-federation/next/config'

export default withNextFederation({
  // your Next config, e.g. cacheComponents: true
})
```

The wrapper records whether `cacheComponents` is on, so the adapter picks the matching cache
implementation. See [Caching](caching.md).

## 3. Define the federation

```ts
// lib/federation.ts
import 'server-only'
import { defineFederation } from '@next-federation/core'
import { createIslands } from '@next-federation/next/server'

export const federation = defineFederation({
  remotes: { shop: { origin: 'https://shop.example.com' } },
})

export const { RemoteIsland, preloadIsland, revalidateIsland } = createIslands(federation)
```

A remote is an origin, not a path. The host fetches envelopes only from this origin (and from
`assetOrigins`, if you list any), and it refuses redirects.

## 4. Render an island

```tsx
// app/page.tsx
import { RemoteIsland } from '../lib/federation'

export default function Home() {
  return (
    <main>
      <RemoteIsland
        remote="shop"
        island="ProductPanel"
        props={{ sku: 'A1' }}
        fallback={<p>loading product…</p>}
        errorFallback={<p>product unavailable</p>}
      />
    </main>
  )
}
```

- `props` must be plain JSON. Functions, `Date`, `Map` and class instances throw `NF-009`.
- `RemoteIsland` renders its own `<Suspense fallback={fallback}>`.
- `errorFallback` shows when the remote is down, slow or returns an invalid envelope. It defaults to
  `fallback`.
- A public island is cached. `revalidate` (seconds) overrides `islands.revalidate`; `dynamic` fetches
  on every request.

## 5. Per-user islands (optional)

A private island renders for the signed-in user. Add `identity` to `defineFederation`, a `getIdentity`
function, and the token routes. See [Identity](identity.md) for the full setup and key rotation.

```tsx
<RemoteIsland remote="shop" island="MyOrders" private fallback={<p>loading orders…</p>} />
```

Without `cacheComponents`, a private island makes the route dynamic.

## 6. Open the CSP

Add each remote origin to `script-src`, `connect-src` and `style-src`. See [CSP](csp.md).

## What to know

- Island HTML is stored about three times in the page. Keep islands small ([Limits](limits.md)).
- React context does not cross into an island, and islands cannot be nested.
- App Router hosts never provide their React to islands, because Next runs its own React build. Each
  distinct remote downloads its own React.
- Remote components (client components, with SSR): see [Remote components](remote-components.md).

Related: [Caching](caching.md), [Deployment](deployment.md), [Limits](limits.md).
