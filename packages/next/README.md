# @next-federation/next

Next.js adapter: embeds remote islands and remote components in an App Router or Pages Router host and serves the host's identity routes. Supports Next `>=15.5.28 <17`; `cacheComponents` needs Next 16.

## Install

```npm
npm install @next-federation/next @next-federation/core @next-federation/react
```

## Usage

```ts title="next.config.ts"
import { withNextFederation } from '@next-federation/next/config'

export default withNextFederation({})
```

```ts title="lib/federation.ts"
import { defineFederation } from '@next-federation/core'
import { createIslands } from '@next-federation/next/server'

export const federation = defineFederation({
  remotes: { shop: { origin: 'https://shop.example.com' } },
})

export const { RemoteIsland } = createIslands(federation)
```

```tsx title="app/page.tsx"
import { RemoteIsland } from '../lib/federation'

export default function Page() {
  return <RemoteIsland remote="shop" island="Cart" props={{ sku: 'A1' }} fallback={<p>Loading…</p>} />
}
```

## Entry points

No root entry. Import from one of these.

| Entry                                    | Exports                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@next-federation/next/config`           | `withNextFederation`                                                                                              |
| `@next-federation/next/server`           | `createIslands`, `getComponentDescriptor` (App Router, server only)                                               |
| `@next-federation/next/routes`           | `createFederationRoutes`                                                                                          |
| `@next-federation/next/components`       | `createRemoteComponent`, `loadRemoteModule`, `preloadRemoteComponent`, `registerSharedModules`, `COMPONENT_EVENT` |
| `@next-federation/next/pages`            | `RemoteIsland`                                                                                                    |
| `@next-federation/next/pages/server`     | `createPagesIslands`, `createFederationApiHandler`, `getComponentDescriptor`, `preloadRemoteComponent`            |
| `@next-federation/next/pages/components` | Same as `/components`, for the Pages Router                                                                       |
| `nf-types` (bin)                         | Downloads remote component prop types                                                                             |

## API

### withNextFederation(config)

Required in every Next host. Wraps a Next config object or `(phase, ctx) => config` function. Adapter entry points fail with `NF-017` without it.

```ts
export default withNextFederation({ basePath: '/shop' })
```

It sets `env.NF_CACHE_MODEL`, `env.NF_BASE_PATH` and `env.NF_NEXT_VERSION`, aliases the internal `island-cache` entry for your cache model, and appends the package to `transpilePackages`. It throws `NF-002` when a `@next-federation/*` package is in `serverExternalPackages`.

### createIslands(federation, options?)

App Router only. Returns `{ RemoteIsland, preloadIsland, revalidateIsland }`.

| Option        | Type          | Default | Description                                                                            |
| ------------- | ------------- | ------- | -------------------------------------------------------------------------------------- |
| `getIdentity` | `AppIdentity` | none    | `({ cookies, headers }) => identity \| null`. Needed for `private` islands (`NF-013`). |

```ts title="lib/federation.ts"
export const { RemoteIsland, preloadIsland, revalidateIsland } = createIslands(federation, {
  getIdentity,
})
```

#### RemoteIsland

A Server Component that fetches an island and renders it inside its own `<Suspense>`.

| Prop                 | Type                      | Default                                      | Description                                                                |
| -------------------- | ------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `remote`             | `string`                  | required                                     | Remote name from `defineFederation`.                                       |
| `island`             | `string`                  | required                                     | The island name.                                                           |
| `props`              | `Record<string, unknown>` | none                                         | Plain JSON props (`NF-009` otherwise).                                     |
| `private`            | `boolean`                 | `false`                                      | Per-user island. Anonymous visitors see `errorFallback`.                   |
| `dynamic`            | `boolean`                 | `false`                                      | Fetch on every request. The route becomes dynamic.                         |
| `revalidate`         | `number`                  | `islands.revalidate`                         | Seconds a public envelope is cached.                                       |
| `locale`             | `string`                  | none                                         | URL prefix segment passed to the remote. `''` for none.                    |
| `fallback`           | `ReactNode`               | none                                         | The loading state.                                                         |
| `errorFallback`      | `ReactNode`               | `fallback`                                   | Shown when the remote fails or an anonymous visitor hits a private island. |
| `inertOnLoadFailure` | `boolean`                 | `true` without `errorFallback`, else `false` | On `NF-011`, keep the server HTML, not interactive.                        |
| `blocking`           | `boolean`                 | `false`                                      | Private only (`NF-002`). Drops the `<Suspense>`: in first HTML.            |

```tsx
<RemoteIsland remote="shop" island="Cart" props={{ sku }} fallback={<Spinner />} errorFallback={<p>Cart unavailable</p>} />
```

With `cacheComponents`, a page that uses `blocking` must export `instant = false`. See the [caching reference](https://github.com/tariqule/next-federation/blob/main/docs/guides/caching-reference.mdx).

#### preloadIsland(spec)

Starts the load early, for example in a layout. An equal `RemoteIsland` in the same request reuses it. It never throws.

#### revalidateIsland(remote, island?)

Expires `nf:<remote>` or `nf:<remote>:<island>` immediately, such as from a deploy webhook. Throws `NF-001` for an unknown remote.

### createPagesIslands(federation, options?)

Pages Router, server only. Returns `{ getIslandProps }`.

| Option        | Type            | Default | Description                                                |
| ------------- | --------------- | ------- | ---------------------------------------------------------- |
| `getIdentity` | `PagesIdentity` | none    | `(req) => identity \| null`. Needed for `private` islands. |

```ts title="lib/federation.ts"
export const { getIslandProps } = createPagesIslands(federation, { getIdentity })
```

#### getIslandProps(ctx, spec)

Returns `IslandProps` (`{ remote, envelope, host, token }`, plus `stale: true` for a stale-if-error envelope) to spread into `RemoteIsland`. `spec` takes `remote`, `island`, `props` and `private`. A failed island or an anonymous visitor on a private island gives `envelope: null`. Mistakes throw `NF-001`, `NF-009` or `NF-017`. `private: true` works in `getServerSideProps` only (`NF-002` otherwise).

```ts title="pages/product.tsx"
export const getStaticProps = async (ctx) => {
  const banner = await getIslandProps(ctx, { remote: 'shop', island: 'Banner' })
  return { props: { banner }, revalidate: banner.envelope && !banner.stale ? 60 : 5 }
}
```

### RemoteIsland (Pages Router)

From `@next-federation/next/pages`. Spread `getIslandProps` into it. It renders `errorFallback ?? fallback` when `envelope` is `null`.

| Prop                 | Type        | Default                                      | Description                                            |
| -------------------- | ----------- | -------------------------------------------- | ------------------------------------------------------ |
| `fallback`           | `ReactNode` | none                                         | Shown when `envelope` is `null`.                       |
| `errorFallback`      | `ReactNode` | `fallback`                                   | Shown when the remote failed or after an island error. |
| `inertOnLoadFailure` | `boolean`   | `true` without `errorFallback`, else `false` | As for the App Router `RemoteIsland`.                  |

```tsx title="pages/product.tsx"
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'

export default function Product({ cart }: { cart: IslandProps }) {
  return <RemoteIsland {...cart} fallback={<p>Cart unavailable</p>} />
}
```

### createFederationRoutes(federation, options)

Creates the JWKS and token route handlers for the App Router. Returns `{ GET, POST }`.

| Option        | Type          | Default  | Description                                                 |
| ------------- | ------------- | -------- | ----------------------------------------------------------- |
| `getIdentity` | `AppIdentity` | required | Reads your same-origin session. The library sets no cookie. |

```ts title="app/api/next-federation/[...nf]/route.ts"
import { createFederationRoutes } from '@next-federation/next/routes'
import { federation } from '@/federation'

export const { GET, POST } = createFederationRoutes(federation, {
  getIdentity: async ({ cookies }) => {
    const session = cookies.get('session')?.value
    return session ? { sub: await userIdFor(session) } : null
  },
})
```

| Route                     | Answer                                                                |
| ------------------------- | --------------------------------------------------------------------- |
| `GET jwks`                | Public keys, `public, max-age=300`.                                   |
| `POST token?aud=<remote>` | `{ token, expiresAt, identityKey }`. Anonymous: `200 {"token":null}`. |
| anything else             | `404`.                                                                |

A request with `Sec-Fetch-Site` not `same-origin` gets `403`. Creating the routes calls `validateIdentity(federation)`, so a malformed key logs `NF-002` at load. Key rotation: [Identity](https://github.com/tariqule/next-federation/blob/main/docs/guides/identity.mdx#rotate-a-signing-key).

### createFederationApiHandler(federation, options)

The Pages Router version of the routes, from `@next-federation/next/pages/server`. Returns a `NextApiHandler`.

| Option        | Type            | Default  | Description                  |
| ------------- | --------------- | -------- | ---------------------------- |
| `getIdentity` | `PagesIdentity` | required | `(req) => identity \| null`. |

```ts title="pages/api/next-federation/[...nf].ts"
import { createFederationApiHandler } from '@next-federation/next/pages/server'
import { federation } from '@/federation'

export default createFederationApiHandler(federation, {
  getIdentity: (req) => (req.cookies.session ? { sub: userIdFor(req.cookies.session) } : null),
})
```

Island scripts run in the host origin, so any island on the page can request a token for any configured remote.

### getComponentDescriptor(federation, remote, options?)

From `/server` (App Router) or `/pages/server`. Resolves and verifies the build of a components remote this render uses. Only a signed or pinned build keeps `ssr`; an unsigned build renders in the browser only (`NF-028`), and a bad signature is refused (`NF-027`). When the remote is down it returns the last known descriptor, or `null`.

| Option    | Type      | Default | Description                                                       |
| --------- | --------- | ------- | ----------------------------------------------------------------- |
| `dynamic` | `boolean` | `false` | Fetch on every request. With `cacheComponents`, use `<Suspense>`. |

```tsx title="app/cart.tsx"
import { getComponentDescriptor } from '@next-federation/next/server'

const descriptor = await getComponentDescriptor(federation, 'shop')
return <Cart descriptor={descriptor} items={3} /> // Cart: createRemoteComponent in a 'use client' file
```

### createRemoteComponent and the other components exports

`/components` (App Router) and `/pages/components` (Pages Router) are `'use client'` entries. They export `createRemoteComponent`, `loadRemoteModule`, `preloadRemoteComponent`, `registerSharedModules` and `COMPONENT_EVENT`, like `@next-federation/react/components` (without `fetchDescriptorInBrowser`). `preloadRemoteComponent` and a component's `preload` take `{ timeoutMs }` and then resolve a `PreloadResult`, and components take `browserOnly` (see the [React README](https://github.com/tariqule/next-federation/blob/main/packages/react/README.md#preloadremotecomponentdescriptor-expose-options)). `/pages/server` also exports `preloadRemoteComponent` and registers `next/link` and `next/router`. These entries are client modules, so a preload is not callable from an App Router Server Component. In the Pages Router, `getServerSideProps` is the supported place to set `Cache-Control: no-store` for a non-`ready` result. They also share the host's `next/link` and `next/navigation` (`next/router` in Pages) with remotes that list them in `shared`.

```tsx title="lib/NavMenu.tsx"
'use client'
import { createRemoteComponent } from '@next-federation/next/components'

export const NavMenu = createRemoteComponent({ expose: './NavMenu', fallback: null })
```

A remote component that imports a module the host does not provide is refused and renders `errorFallback`, also after hydration (`NF-036`). Builds refused for integrity or trust are never loaded in the browser. See [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/overview.mdx).

### nf-types

Downloads each components remote's prop types into `next-federation-types/<remote>/` and writes `index.d.ts`, which fills `RemoteProps`.

```bash
nf-types --config lib/federation.config.ts [--remote shop]... [--out next-federation-types]
```

| Flag       | Description                                                                 |
| ---------- | --------------------------------------------------------------------------- |
| `--config` | Federation file with no Next.js imports. Exports `federation` or a default. |
| `--remote` | A remote to sync. Repeatable. Default: every remote with `components`.      |
| `--out`    | Output folder. Default `next-federation-types`.                             |

```tsx
createRemoteComponent<RemoteProps<'shop', './Cart'>>({ expose: './Cart' })
```

A `.ts` config needs Node 22.18 or 23.6 or newer; otherwise use `.mjs`. It does not read `.env.local`, runs nothing it downloads, checks every file's sha384 and exits 1 when a remote fails. See [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/types.mdx).

### Types

`IslandSpec`, `RemoteIslandProps`, `AppIdentity`, `PagesIdentity`, `PagesIslandSpec`, `IslandProps`, `ComponentDescriptorOptions`, `RemoteComponentDescriptor`, `PreloadResult`, `PreloadOptions`, `ComponentEvent`.

## Learn more

- [App Router guide](https://github.com/tariqule/next-federation/blob/main/docs/guides/getting-started-app-router.mdx)
- [Pages Router guide](https://github.com/tariqule/next-federation/blob/main/docs/guides/getting-started-pages-router.mdx)
- [Caching](https://github.com/tariqule/next-federation/blob/main/docs/guides/caching.mdx)
- [Identity](https://github.com/tariqule/next-federation/blob/main/docs/guides/identity.mdx)
- [CSP](https://github.com/tariqule/next-federation/blob/main/docs/guides/csp.mdx)
- [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/overview.mdx)
- [Sharing components from a Next app](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/sharing-from-a-next-app.mdx)

License: MIT
