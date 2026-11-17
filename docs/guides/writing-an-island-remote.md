# Writing an island remote

A remote is a Vite 8 app that runs React Server Components on its own server and answers island
requests. Hosts embed the result. This guide builds one with `@next-federation/vite`.

Requires Node `^20.19.0 || >=22.12.0` (Vite 8's floor).

## 1. Install

```sh
pnpm add @next-federation/island react react-dom react-server-dom-webpack
pnpm add -D @next-federation/vite @next-federation/server vite
```

## 2. Configure Vite

```ts
// vite.config.ts
import { nextFederationIslands } from '@next-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: nextFederationIslands({
    name: 'shop',
    base: 'https://shop.example.com/',
    hosts: ['https://www.example.com'],
    issuers: {
      'https://www.example.com': 'https://www.example.com/api/next-federation/jwks',
    },
    islands: {
      ProductPanel: './src/islands/ProductPanel.tsx',
      MyOrders: { entry: './src/islands/MyOrders.tsx', private: true },
    },
  }),
})
```

| Option      | Meaning                                                                                |
| ----------- | -------------------------------------------------------------------------------------- |
| `name`      | Remote id. It is the token audience, so it must equal the name the host configures.    |
| `base`      | Absolute URL the remote is served from. A relative `base` fails with `NF-020`.         |
| `hosts`     | Exact browser origins allowed to embed (CORS and `Origin` check). No `*`.              |
| `issuers`   | Trusted token issuers: exact `iss` value to JWKS URL. Needed for private islands.      |
| `islands`   | Island name to entry file, or `{ entry, private }`.                                    |

The full option list is in the [`@next-federation/vite` README](../../packages/vite/README.md).
`@vitejs/plugin-rsc` is pinned to exactly 0.5.39. Any other version fails with `NF-025`, unless
`NF_ALLOW_PLUGIN_RSC=1` is set (for a CI canary only).

## 3. Write an island

An island entry is a Server Component with a default export. It may not start with `'use client'`
(`NF-002`). Put interactive code in client components it renders.

```tsx
// src/islands/ProductPanel.tsx
import './ProductPanel.css'
import { getProduct } from '../data'
import { Counter } from './Counter'

export default async function ProductPanel({ sku }: { sku: string }) {
  const product = await getProduct(sku)
  return (
    <section className="product-panel">
      <h2>{product.name}</h2>
      <p>${product.price}</p>
      <Counter />
    </section>
  )
}
```

```tsx
// src/islands/Counter.tsx
'use client'
import { useState } from 'react'

export function Counter() {
  const [n, setN] = useState(0)
  return <button onClick={() => setN((v) => v + 1)}>count {n}</button>
}
```

CSS you import goes into the envelope. Do not call `import.meta.viteRsc.loadCss()` yourself: the
build fails with `NF-002`.

## 4. Per-user content

```tsx
import { getIdentity } from '@next-federation/island'

export default async function MyOrders() {
  const user = getIdentity() // { sub, ... } from a verified token
  if (!user) throw new Error('MyOrders requires identity')
  return <h2>Orders for {user.sub}</h2>
}
```

A `private: true` island is never rendered without a verified token. `getIdentity()` works in Server
Components and (later) Server Actions. In client code it throws `NF-002`: pass what the client needs
as props. See [Identity](identity.md).

## 5. Links

```tsx
import { Link } from '@next-federation/island'

<Link href="/orders/1">Order</Link>
```

`Link` renders a real `<a href>`. Write host-relative hrefs (`/orders/1`). The host's `basePath` and
locale are added for you, and plain left clicks use the host router.

## 6. Build and serve

```sh
vite build                                  # writes dist/<buildId>/{client,ssr,rsc} and nf-build.json
nf-serve --dir dist --port 4100             # from @next-federation/server
```

`vite` serves the remote in development. See [Deployment](deployment.md) for production, including
build retention.

## Rules and limits

- Props are plain JSON. React context does not cross into an island.
- Islands cannot be nested inside other islands.
- No CSS isolation. Scope your own class names; there is no Shadow DOM.
- Island metadata (`<title>`, `<meta>`, `<link>`) never reaches the host `<head>`. The server strips
  it from the island HTML. In development, `NF-018` names anything it stripped.
- No Fast Refresh. `@vitejs/plugin-react` and `@vitejs/plugin-react-swc` are rejected (`NF-002`), and
  islands inside a host reload instead of hot-refreshing.
- Server Actions reach client components only as props from a Server Component (`NF-034` for a
  client import), and forms use `<Form>` from `@next-federation/island` (`NF-035` for a plain
  `<form action>`).
- Keep islands small. Island HTML appears about three times in a host page, and the host warns above
  100 KB per envelope (`NF-024`).
- Run your server and client bundle in the same React mode (production with production).

See [Limits](limits.md) for JS cost.
