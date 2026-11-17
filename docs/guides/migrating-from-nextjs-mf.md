# Migrating from nextjs-mf

`@module-federation/nextjs-mf` is in maintenance mode (module-federation/core#3153). It works only
with the Pages Router, only with webpack (`NEXT_PRIVATE_LOCAL_WEBPACK`), and it makes Next apps
expose and consume each other's code. next-federation keeps runtime composition but changes who
builds what: **remotes are Vite builds**, and **Next apps are hosts only**. This guide maps the
concepts, then walks a Pages Router app from nextjs-mf to next-federation.

**Next 15 is supported; Next 14 is not.** next-federation needs React 19, so a Next 15 app can stay on
Next 15 (`>=15.5.28`) and a Next 14 app must upgrade to Next 15 or 16 first. `cacheComponents` is Next
16 only ([Limits](limits.md#nextjs-15)).

## Concept map

| nextjs-mf | next-federation |
| --- | --- |
| A remote's exposed **client component** (`exposes: { './Cart': … }`, `dynamic(() => import('shop/Cart'))`) | A **remote component**: the remote builds it with `nextFederationComponents`, the host renders it with `createRemoteComponent`. It runs on the host's React, reads host context, takes any props. Server-rendered for verified builds. [Remote components](remote-components.md) |
| An exposed component that renders **server data** (its own `getServerSideProps`, a whole exposed page, data the remote fetches with its secrets) | An **island**: the remote renders it on its own server (real Server Components) and the host embeds the HTML. [Writing an island remote](writing-an-island-remote.md) |
| `NextFederationPlugin` in `next.config.js` (`name`, `remotes`, `filename`, `extraOptions`) | `withNextFederation()` around `next.config` (no bundler plugin) + `defineFederation({ remotes })` in a server-only module |
| `remotes: { shop: 'shop@https://shop.example.com/_next/static/chunks/remoteEntry.js' }` | `remotes: { shop: { origin: 'https://shop.example.com', components: { … } } }`: the host reads the remote's build descriptor (`/_nf/components.json`) and loads the build it names |
| `exposes` in the remote's Next config | A Vite remote: `nextFederationComponents({ exposes })` (client components) and/or `nextFederationIslands` (islands) |
| `shared: { react: { singleton: true } }`, automatic sharing of `next/*` | React (`react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`) is always the host's; other modules are shared only when the remote lists them and the host passes them ([Sharing modules](remote-components.md#sharing-modules)), with an optional `requiredVersion` and a bundled `fallback` copy. `next/link`, `next/navigation` and `next/router` come from the host's router; no other `next/*` is shared |
| `FlushedChunks` / `flushChunks()` in `_document` for SSR chunk preloading | Automatic: a server-rendered component emits its stylesheets and `modulepreload` links |
| `revalidate()` from `@module-federation/nextjs-mf/utils` to pick up new remote builds | Automatic: the descriptor is re-read within `revalidate` seconds; the browser loads exactly the build the server rendered |
| A Next app as a remote | Not supported. Move the shared code into a Vite remote: [Sharing components from a Next app](sharing-components-from-a-next-app.md) |

## Step by step: a Pages Router app on Next 14 or 15

The example: a host `www` imports `shop/Cart` (a client component) and `shop/Reviews` (renders data
the shop fetches) from a Next app `shop`.

### 1. Take inventory

List every `exposes` entry of every remote and every `import('remote/…')` in the hosts. For each
exposed module decide:

- **Client component** (state, effects, event handlers; data comes in as props): a remote component.
- **Renders server data or needs the remote's secrets**: island.
- **Uses `next/link`, `next/navigation` or `next/router`**: keep it in a remote component. List the
  module in the remote's `shared`, and create the component in the host with
  `@next-federation/next/components` (App Router) or `@next-federation/next/pages/components`
  (Pages Router). The component then renders only in a host with that router.
- **Uses `next/image` or `next/head`**: rewrite that part. In a remote component pass what it needs
  as props (an image URL builder, a callback). In an island use `Link` from
  `@next-federation/island`.

### 2. Build the remote with Vite

Create a Vite package next to the shop app (same repo is fine, separate deploy) and move the exposed
files into it.

```ts
// shop-remote/vite.config.ts
import { nextFederationComponents } from '@next-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    nextFederationComponents({
      name: 'shop',
      base: 'https://shop-remote.example.com/',
      exposes: { './Cart': './src/Cart.tsx' },
      shared: ['@acme/host-context'], // modules the host provides, besides React
    }),
  ],
})
```

CSS imported by an exposed module works as is (`import './Cart.css'`, CSS Modules). Build with
`NF_COMPONENTS_SIGNING_KEY` set so hosts can server-render it ([Key generation](remote-components.md#key-generation)),
and serve `dist/` with `nf-serve` or deploy it ([Deployment](deployment.md)). `Reviews` becomes an
island entry of an island remote ([Writing an island remote](writing-an-island-remote.md)).

### 3. Move the host to next-federation (Next 15 or 16)

1. Remove `@module-federation/nextjs-mf` and the `NextFederationPlugin` block from `next.config.js`.
   Remove `NEXT_PRIVATE_LOCAL_WEBPACK` from your scripts: Turbopack and webpack both work (Next 16
   defaults to Turbopack, `--webpack` opts out; Next 15 defaults to webpack, `--turbopack` opts in).
2. Remove `FlushedChunks` / `flushChunks` from `pages/_document` and any `revalidate()` call.
3. On Next 15, make sure React is 19: `pnpm add next@15 react@19 react-dom@19` (Next 15's Pages Router
   also runs on React 18, which next-federation does not support). On Next 14, upgrade: `pnpm add
   next@16 react@19 react-dom@19` (or `next@15`), then follow the Next 15 (and 16) upgrade guides for
   the rest of the app (async request APIs, removed options).
4. Install next-federation and wrap the config:

```sh
pnpm add @next-federation/core @next-federation/next @next-federation/react
```

```ts
// next.config.ts
import { withNextFederation } from '@next-federation/next/config'

export default withNextFederation({
  // the rest of your Next config
})
```

### 4. Configure the remote

```ts
// lib/federation.config.ts (import it only from getServerSideProps, getStaticProps and API routes;
// no Next.js imports here, so that `nf-types` can load it)
import { defineFederation } from '@next-federation/core'

export const federation = defineFederation({
  remotes: {
    shop: {
      origin: 'https://shop-remote.example.com',
      components: { ssr: { publicKeys: [JSON.parse(process.env.NF_COMPONENTS_PUBLIC_KEY!)] } },
    },
  },
})
```

### 5. Replace the dynamic imports

Before:

```tsx
const Cart = dynamic(() => import('shop/Cart'), { ssr: true })
```

After:

```tsx
// lib/cart.tsx
import * as HostContext from '@acme/host-context'
import { createRemoteComponent } from '@next-federation/react/components'

export const Cart = createRemoteComponent<{ items: number }>({
  expose: './Cart',
  shared: { '@acme/host-context': { version: '1.0.0', module: HostContext } },
  fallback: <p>Loading the cart…</p>,
  errorFallback: <p>Cart unavailable</p>,
})
```

```tsx
// pages/index.tsx
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import { federation } from '../lib/federation.config'
import { Cart } from '../lib/cart'

export const getServerSideProps = async () => ({
  props: { descriptor: await getComponentDescriptor(federation, 'shop') },
})

export default function Home({ descriptor }) {
  return <Cart descriptor={descriptor} items={3} />
}
```

A remote that is down renders the fallback with status 200, as before. Replace `shop/Reviews` with
`RemoteIsland` ([Pages Router host](getting-started-pages-router.md)).

### 6. Check sharing and styles

- Every module the remote lists in `shared` must be passed by the host in `createRemoteComponent`;
  there is no version negotiation (the host's copy is used whatever its version).
- Add the remote's origin to `script-src`, `style-src` and `connect-src` if you have a CSP
  ([CSP](csp.md)).

### 7. Move the App Router later (optional)

The same remote works in App Router pages: `getComponentDescriptor` from
`@next-federation/next/server` in a Server Component, the `createRemoteComponent` module marked
`'use client'` ([App Router](remote-components.md#app-router)).

## What has no equivalent

- **Next apps as remotes**, including exposed pages (`exposePages`) and exposing `app/` or `pages/`
  components. Move shared code into a Vite remote.
- **Sharing all of `next/*`** (nextjs-mf shared Next's modules automatically). Only `next/link`,
  `next/navigation` and `next/router` are shared, from the host's router. Pass anything else as
  props.
- **`strictVersion`, `eager` and `singleton` per module.** A remote sets `requiredVersion` and
  `fallback` only; the host checks the range before loading (`NF-036`), and React is always the
  host's.
- **Static `import 'shop/Cart'`** in host code (a host import loader is planned after v1).
- **Rspack or webpack remotes**: untested. Remotes build with `@module-federation/vite`.
- **Type generation from the remote** (the MF `dts` plugin is off). Type the props in
  `createRemoteComponent<Props>()`.
- **Server rendering of an unverified build**: without a signed descriptor, a pinned digest or
  `unsafe-dev` in development, the component renders in the browser only.

See [Limits](limits.md).
