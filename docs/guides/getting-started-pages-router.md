# Getting started: Next.js Pages Router host

Runnable example: [examples/next-pages-router](../../examples/next-pages-router)

This guide embeds an island from a remote app in a Next.js 16 or 15 Pages Router page. It covers the
host only. To build the remote, see [Writing an island remote](writing-an-island-remote.md).

Supported: Next.js 16 or 15 (`>=15.5.28 <17`), React 19, Turbopack or webpack, Node 20.9 or newer.
On Next 15 the adapter uses the legacy caching model (fetch `revalidate` and tags):
`cacheComponents` needs Next 16 ([Limits](limits.md#nextjs-15)). Next 14 is not supported. Next 15
uses webpack unless you pass `--turbopack`; both work.

## Remote components or islands

This guide sets up islands. A remote can also ship remote components, and a host can use both. The
[App Router guide](getting-started-app-router.md#choosing-between-remote-components-and-islands)
compares them, and [Remote components](remote-components.md) covers the setup.

## 1. Install

```sh
pnpm add @next-federation/core @next-federation/next @next-federation/react
pnpm add --save-exact react@19.3.1 react-dom@19.3.1
```

Pin React to one exact version, the one the repo's tests run (19.3.1), whatever version
`create-next-app` scaffolds: the remotes you embed should run the same version to share one copy of
React.
`pnpm add --save-exact` does not remove a caret that is already in `package.json`: check the file,
and edit the range by hand if `react` or `react-dom` still starts with `^`.

These commands use pnpm 10 or newer: `create-next-app --use-pnpm` writes a `pnpm-workspace.yaml` that
pnpm 9 rejects (`packages field missing or empty`). With npm, run `npm install <packages>` and
`npm install --save-exact react@19.3.1 react-dom@19.3.1`.

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

Use two files. The config imports nothing from Next.js, so `nf-types` (remote components) can load it
with plain Node.

```ts
// lib/federation.config.ts
import { defineFederation } from '@next-federation/core'

export const federation = defineFederation({
  remotes: { shop: { origin: process.env.SHOP_ORIGIN ?? 'https://shop.example.com' } },
})
```

Import `lib/federation.ts` only from `getServerSideProps`, `getStaticProps` and API routes.

```ts
// lib/federation.ts
import { createPagesIslands } from '@next-federation/next/pages/server'
import { federation } from './federation.config'

export { federation }
export const { getIslandProps } = createPagesIslands(federation)
```

Environment variables the config reads come from `.env.local` under `next dev` and `next build`,
but not under plain Node: see [Remote components](remote-components.md#types) for `nf-types`.

### Timeout and retries

`timeoutMs` and `retries` work as in the App Router host
([Timeout and retries](getting-started-app-router.md#timeout-and-retries)). A failed island renders
`errorFallback` (default: `fallback`) and the page still answers `200`.

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

In `getStaticProps` the page's own `revalidate` is the island cache. When the remote fails, the page keeps
the island's last good envelope from this server process (`stale: true`), or gets `envelope: null` (the
fallback) without one ([Caching](caching.md#stale-if-error)). Either way, regenerate soon:

```ts
export const getStaticProps: GetStaticProps<Props> = async (ctx) => {
  const banner = await getIslandProps(ctx, { remote: 'shop', island: 'Banner' })
  return { props: { banner }, revalidate: banner.envelope && !banner.stale ? 60 : 5 }
}
```

## Per-user islands

Private islands work in `getServerSideProps` only. Calling `getIslandProps` with `private: true` from
`getStaticProps` throws `NF-002` (there is no request to read the user from). See [Identity](identity.md).

## Share the host's React (recommended)

When the host and its island remotes run the identical React version (step 1 pins it), call
`provideHostReact()` in `pages/_app.tsx`, at module scope. Without it, the page downloads a second
copy of React for the islands (about 80 KB gzip for the first remote), next to the host's own.

```tsx
// pages/_app.tsx
import type { AppProps } from 'next/app'
import { provideHostReact } from '@next-federation/react/share'

provideHostReact()

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}
```

Islands built on the host's exact version then use the host's React and download none of their own
(about 12 KB per remote instead). It is safe to call in every Pages Router host: it does nothing in
development, on a React pre-release, or for an island on another React version (that island keeps
its own copy). In a host with App Router and Pages Router routes, call it in `pages/_app.tsx` too: it
covers the Pages Router pages (App Router pages never provide React). See [Limits](limits.md#cost)
for what it saves.

## What to know

- Add each remote origin to `script-src`, `connect-src` and `style-src`; [CSP](csp.md) has a complete
  policy for Next.js in dev and production.
- Island HTML is stored about three times in the page. React context does not cross into an island.
- Remote components (client components, with SSR): see [Remote components](remote-components.md).

Related: [Caching](caching.md), [Deployment](deployment.md), [Limits](limits.md).
