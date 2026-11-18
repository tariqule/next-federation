# Writing an island remote

Runnable example: [examples/vite-remote](../../examples/vite-remote)

A remote is a Vite 8 app that runs React Server Components on its own server and answers island
requests. Hosts embed the result. This guide builds one with `@next-federation/vite`.

Requires Node `^20.19.0 || >=22.12.0` (Vite 8's floor).

## Start from create-vite

`npm create vite@latest shop -- --template react-ts` gives you a Vite 8 project, but it is a browser
app and a remote is not. Make these edits (checked against Vite 8.3.8):

1. Remove `@vitejs/plugin-react` (and `@vitejs/plugin-react-swc`) from `package.json` and from
   `vite.config.ts`. The build fails with `NF-002` while either is present: Fast Refresh needs a
   preamble that only a Vite-served page has. Vite's own compiler handles JSX without them.
2. Delete what only a browser app uses: `index.html`, `src/main.tsx`, `src/App.tsx`,
   `src/App.css`, `src/index.css` and `src/assets/`. A remote has no page. The island handler answers
   `/_nf/*` and the build serves `dist/<buildId>/client/assets/`.
3. Replace `vite.config.ts` with the config in step 2 below, and put your islands in
   `src/islands/`.
4. Change the build script from `tsc -b && vite build` to `vite build`, and add
   `"start": "nf-serve --dir dist --port 4100"`. If you keep `tsc -b` as a type check, make sure
   step 2 removed `src/main.tsx` too: it imports `App.tsx` and `index.css`, which step 2 deletes, so
   it no longer type-checks. `vite preview` does not serve a remote: use `nf-serve`.
5. Pin React ([React versions](../../README.md#status-and-compatibility)). The scaffold installs a caret range and
   `react-server-dom-webpack` is not in it: add it at the same exact version as `react`.
6. oxlint (the scaffold's `lint` script and `.oxlintrc.json`) is independent of the build. Keep
   it or delete it; nothing in next-federation reads it. Its `react/only-export-components` rule
   protects Fast Refresh, which a remote does not have, so you can turn it off.
7. TypeScript: any version installs, and an island remote works with any (it does not use
   `types`). A components remote with `types: true`
   ([Remote components](remote-components.md#types)) needs TypeScript 5 or 6: with TypeScript 7,
   which create-vite currently installs, the build still succeeds, warns `NF-002` naming
   `npm install -D typescript@6`, and publishes no types.
8. `node:*` imports in island code: island Server Components and Server Actions run on Node, so
   they can read files or a database (`import { readFile } from 'node:fs/promises'`). The
   scaffold's `tsconfig.app.json` lists only `"types": ["vite/client"]`, so `tsc -b` fails with
   "Cannot find module 'node:fs'". Add `"node"` to that list (`"types": ["vite/client", "node"]`) and
   keep `@types/node` in `devDependencies` (create-vite already installs it for its Vite config).
   Never import a `node:*` module from a `'use client'` file: it runs in the browser.

## 1. Install

Pin React and React DOM to one exact version (the repo's tests run 19.3.1) and
`react-server-dom-webpack` to the same one. `@next-federation/vite` lists `react-server-dom-webpack`
as an optional peer dependency (a components remote never uses it), so npm does not install it for
you: an island remote without it fails at `vite` startup with `NF-002`, naming the install command
for your React version.

```sh
pnpm add --save-exact react@19.3.1 react-dom@19.3.1 react-server-dom-webpack@19.3.1
pnpm add @next-federation/island
pnpm add -D @next-federation/vite @next-federation/server vite
```

`pnpm add --save-exact` does not remove a caret that is already in `package.json` (`create-vite`
writes `"react": "^19.3.1"`): check the file, and edit the range by hand if it still starts with `^`.

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

### Host origins and issuers must match exactly

`hosts` and `issuers` are compared as strings, and they are part of the build (they live in the
remote's server bundle). Three things to get right:

- **`hosts` are origins:** scheme, host and port, no path and no trailing slash. A host with a
  `basePath` of `/app` is still `https://www.example.com`.
- **`issuers` are the host's `identity.issuer`, character for character, and include the
  `basePath`.** The JWKS URL includes it too. For a host at `https://www.example.com/app`:

  ```ts
  // remote vite.config.ts
  hosts: ['https://www.example.com'],
  issuers: {
    'https://www.example.com/app': 'https://www.example.com/app/api/next-federation/jwks',
  },
  ```

  ```ts
  // host lib/federation.config.ts
  identity: { issuer: 'https://www.example.com/app', signingKeys: process.env.NF_SIGNING_KEY! },
  ```

  A mismatch answers `401` with [`NF-016`](../errors/issuer-not-allowed.md) (a host origin that is not
  listed is `403` [`NF-022`](../errors/origin-not-allowed.md)). `http://127.0.0.1:3000` and
  `http://localhost:3000` are different origins, and so are `www.example.com` and `example.com`.
- **Every new host origin needs a rebuild of the remote.** A preview deployment, a staging domain
  or a new dev port is a new origin: add it to `hosts` and `issuers` and run `vite build` again (a
  new build id). Build the lists from an environment variable if you deploy to many origins.

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

```ts
// src/data.ts
const products: Record<string, { name: string; price: number }> = {
  A1: { name: 'Desk lamp', price: 39 },
}

export async function getProduct(sku: string) {
  return products[sku] ?? { name: `Unknown product ${sku}`, price: 0 }
}
```

```css
/* src/islands/ProductPanel.css */
.product-panel {
  border: 1px solid #ddd;
  padding: 1rem;
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
Components and in [Server Actions](server-actions.md). In client code it throws `NF-002`: pass what the client needs
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

`vite build` prints `[MODULE_LEVEL_DIRECTIVE] The semantics of the module level directive "use
client" ... may not be preserved when bundling` once per client component, including the ones in
`@next-federation/island`. They are harmless. They come from the client build, where Rolldown
drops the directive from a file it bundles; the client references were already found in the
earlier "analyze client references" pass. Islands built with these warnings hydrate, run their
actions and load their CSS. Ignore them.

## Develop against a host

Run the remote with `vite` and point the host at it (`origin: 'http://localhost:4100'`, with the
dev server on that port). The loop is manual:

- **Edit, then reload the host page.** Nothing refreshes by itself: there is no Fast Refresh, and
  the host does not know the remote changed.
- **A static public island can show an older version.** The host caches its envelope (60 seconds by
  default), so a reload may serve the cached envelope until it revalidates, in `next dev` too. With
  `dynamic`, the island is fetched fresh on every request. Use it while you work on the island (see
  [Caching](caching.md)):

  ```tsx
  <RemoteIsland remote="shop" island="ProductPanel" dynamic fallback={<p>loading…</p>} />
  ```

  Remove it before you ship: `dynamic` fetches on every request and makes the route dynamic.
- Private islands are never cached, so they show your edits on reload.
- The first host load against a remote with a cold Vite cache hydrates with one React: the plugin
  pre-bundles React and never pre-bundles `@next-federation/island`. If a package your own island
  client components import still triggers `optimized dependencies changed`, add it to
  `optimizeDeps.include` in the remote's Vite config, but not a package with `'use client'`
  components of its own.
- To test the real server build, use `vite build` and `nf-serve`.

## Rules and limits

- Props are plain JSON. React context does not cross into an island.
- Do not nest islands. An island that renders another remote's island works, silently, but the inner
  island gets no identity and is outside the host's cache and skew handling, with an extra server hop
  ([Limits](limits.md#what-an-island-cannot-do)). Embed both islands from the host instead.
- No CSS isolation. Scope your own class names; there is no Shadow DOM.
- Island metadata (`<title>`, `<meta>`, `<link>`) never reaches the host `<head>`. The server strips
  it from the island HTML. In development, `NF-018` names anything it stripped.
- No Fast Refresh. `@vitejs/plugin-react` and `@vitejs/plugin-react-swc` are rejected (`NF-002`), and
  islands inside a host do not refresh on their own: reload the host page after an edit
  ([Develop against a host](#develop-against-a-host)).
- Server Actions reach client components only as props from a Server Component (`NF-034` for a
  client import), and forms use `<Form>` from `@next-federation/island` (`NF-035` for a plain
  `<form action>`).
- Keep islands small. Island HTML appears about three times in a host page, and the host warns above
  100 KB per envelope (`NF-024`).
- Run your server and client bundle in the same React mode (production with production).

See [Limits](limits.md) for JS cost.
