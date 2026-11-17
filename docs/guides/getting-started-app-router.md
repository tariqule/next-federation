# Getting started: Next.js App Router host

This guide embeds an island from a remote app in a Next.js 16 or 15 App Router page. It covers the
host only. To build the remote, see [Writing an island remote](writing-an-island-remote.md).

Supported: Next.js 16 or 15 (`>=15.5.28 <17`), React 19, Turbopack or webpack, Node 20.9 or newer.
On Next 15 the adapter uses the legacy caching model (fetch `revalidate` and tags):
`cacheComponents` needs Next 16 ([Limits](limits.md#nextjs-15)). Next 14 is not supported. Next 15
uses webpack unless you pass `--turbopack`; both work.

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
pnpm add @next-federation/core @next-federation/next @next-federation/react server-only
pnpm add --save-exact react@19.3.1 react-dom@19.3.1
```

`server-only` is imported by `lib/federation.ts` below and is not part of a `create-next-app`
project. Pin React to one exact version, the one the repo's tests run (19.3.1): `create-next-app`
scaffolds 19.1.0 or 19.3.0, and the pin keeps the host on the tested version. An App Router host
never shares its React with islands, so the pin is not about sharing a copy with your remotes.

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

### The Next 16 scaffold turns on `cacheComponents` and `partialPrefetching`

A project from `create-next-app` 16.4.6 has `cacheComponents: true` and `partialPrefetching: true` in
`next.config.ts`. For islands that means:

- Public islands are cached with `'use cache'`, and a page with only public islands stays static
  (`○` in the build output). A failed island becomes a dynamic hole instead of being baked in
  ([Caching](caching.md)).
- A private island is always a dynamic hole inside the island's own `<Suspense>`. Put your own
  `'use cache'` components around a `RemoteIsland` only inside `<Suspense>`.
- Next 16 keeps routes you visited mounted but hidden (the validation saw this with the scaffold
  defaults), so an island on a route you navigated away from can stay mounted in the background.
- `partialPrefetching: true` works with private islands: a signed-in private island renders with no
  "unstable value `Date.now()`" log in `next dev` or `next start`.

On Next 15 the adapter uses the legacy cache. Next 15's experimental equivalents,
`experimental.cacheComponents` and `experimental.dynamicIO`, are not supported: `withNextFederation`
throws [`NF-002`](../errors/invalid-config.md) on Next 15 when either of them, or
`cacheComponents`, is set.

## 3. Define the federation

Use two files. The first is the federation config and imports nothing from Next.js. The second
creates the island components and may import `server-only` and `next/*`.

```ts
// lib/federation.config.ts
import { defineFederation } from '@next-federation/core'

// No Next.js imports in this file: `nf-types` (remote components) loads it with plain Node.
export const federation = defineFederation({
  remotes: { shop: { origin: process.env.SHOP_ORIGIN ?? 'https://shop.example.com' } },
})
```

```ts
// lib/federation.ts
import 'server-only'
import { createIslands } from '@next-federation/next/server'
import { federation } from './federation.config'

export { federation }
export const { RemoteIsland, preloadIsland, revalidateIsland } = createIslands(federation)
```

Every other guide uses this layout ([Identity](identity.md) adds the `identity` block to the config file
and `getIdentity` to `lib/federation.ts`). Environment variables the config reads come from
`.env.local` under `next dev` and `next build`, but not under plain Node: see
[Remote components](remote-components.md#types) for `nf-types`.

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
function, and the token routes. See [Identity](identity.md) for the full setup, a sign-in and
sign-out example, and key rotation.

```tsx
<RemoteIsland
  remote="shop"
  island="MyOrders"
  private
  fallback={<p>loading orders…</p>}
  errorFallback={<p>sign in to see your orders</p>}
/>
```

Give a private island an `errorFallback`. For a visitor who is not signed in, the island makes no
request and renders `errorFallback`, which defaults to `fallback`: without it, an anonymous visitor
sees the loading text for good.

Without `cacheComponents`, a private island makes the route dynamic.

## 6. Open the CSP

Add each remote origin to `script-src`, `connect-src` and `style-src`. Next.js needs more than that
to run under a CSP at all: [CSP](csp.md) has a complete policy for dev and production.

## What to know

- Island HTML is stored about three times in the page. Keep islands small ([Limits](limits.md)).
- React context does not cross into an island, and islands cannot be nested.
- App Router hosts never provide their React to islands, because Next runs its own React build. Each
  distinct remote downloads its own React.
- Remote components (client components, with SSR): see [Remote components](remote-components.md).

Related: [Caching](caching.md), [Deployment](deployment.md), [Limits](limits.md).
