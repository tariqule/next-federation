# @next-federation/next

Next.js adapter for `next-federation` (Next `>=15.5.28 <17`, React 19; `cacheComponents` needs Next 16).
It embeds remote islands and remote components in an App Router or Pages Router host, caches
them with Next's own caching, and serves the host's identity routes.

## Install

```sh
pnpm add @next-federation/next @next-federation/core @next-federation/react
```

## `withNextFederation(config)` (required)

```ts
// next.config.ts
import { withNextFederation } from '@next-federation/next/config'

export default withNextFederation({ basePath: '/shop' })
```

Every Next host must wrap its config. Using public config keys only, the wrapper:

- sets `env.NF_CACHE_MODEL` (`'cache-components'` when `cacheComponents` is on, else `'legacy'`),
  `env.NF_BASE_PATH` (`basePath ?? ''`) and `env.NF_NEXT_VERSION` (the installed Next.js version);
- aliases `@next-federation/next/island-cache` to `/legacy` or `/cache-components` through
  `turbopack.resolveAlias` and a `webpack` function (an existing `webpack` function runs first);
- appends `@next-federation/next` to `transpilePackages`;
- throws `NF-002` when a `@next-federation/*` package is listed in `serverExternalPackages`.

It also accepts the function form `(phase, ctx) => config`. Adapter entry points fail with
`NF-017` when the wrapper is missing.

## Island cache

`getPublicEnvelope(target, island, propsJson, hostJson, revalidate)` has two implementations,
chosen at build time because `'use cache'` only compiles with `cacheComponents`:

- **legacy**: `fetch` with `next: { revalidate, tags: ['nf:<remote>', 'nf:<remote>:<island>'] }`.
  Next's fetch cache stores every 200 response, so a 200 whose body is not a valid envelope
  (`NF-004`) is cached for `revalidate` seconds as well. Non-2xx responses, timeouts and network
  errors are not cached.
- **cache-components**: a `'use cache'` function with
  `cacheLife({ stale: 300, revalidate, expire: max(3600, 2 × revalidate) })` and the same tags.
  A failure is returned, never thrown (Next fails a build-time prerender on any error raised
  inside `'use cache'`), and switches the entry to an inline failure profile
  (`{ stale: 30, revalidate: 5, expire: 600 }`, inlined so a host's `cacheLife` config cannot change
  it). Its `expire` keeps it in the static shell: the page stays static and is regenerated within
  about 5 seconds. (An entry with `expire` under 5 minutes would be a dynamic hole, and a static
  shell left with no changing content gets `revalidate: false` from Next and is never regenerated.)
  `RemoteIsland` renders its own `<Suspense>`, except a private island with `blocking`.
- **Stale-if-error** (both models, and `getIslandProps`): a failed public fetch renders the last good
  envelope this server process fetched for the same remote, island, props and host context, kept
  for at least an hour or twice `revalidate` (at most 500 envelopes, 50 MiB). The failure is still
  logged with its code and emitted as `island:error`. Without one, the fallback renders. Private
  islands (`blocking` or not) and `dynamic` islands are never served stale.

## `RemoteIsland`, `preloadIsland`, `revalidateIsland` (App Router)

```ts
// lib/federation.ts (server-only)
import { createIslands } from '@next-federation/next/server'

export const { RemoteIsland, preloadIsland, revalidateIsland } = createIslands(federation, {
  getIdentity, // the same AppIdentity function as the routes: ({ cookies, headers }) => identity | null
})
```

```tsx
<RemoteIsland remote="shop" island="Cart" props={{ sku }} fallback={<Spinner />} errorFallback={<p>Cart unavailable</p>} />
```

- `RemoteIsland` renders its own `<Suspense fallback={fallback}>` (except with `blocking`, below). `IslandMount` renders
  the island's CSS as `<link rel="stylesheet" precedence="next-federation">` through the host's React (in `<head>`, once
  per href).
- Public islands go through the island cache above (`revalidate` defaults to `islands.revalidate`).
  `dynamic: true` fetches with `cache: 'no-store'`, which makes the route dynamic (a dynamic hole with
  `cacheComponents`).
- `private: true` reads the identity with `cookies()`/`headers()` outside any cache scope and mints the token
  on the server. The token goes only into the request to the remote; the HTML and the props sent to the
  browser carry only the token endpoint. Requires `getIdentity` and `identity` in `defineFederation()`
  (`NF-013`). An anonymous visitor makes no remote request and sees `errorFallback`.
- `blocking` (private islands only; `NF-002` on a public one) leaves out the island's `<Suspense>`, so the island is in
  the first HTML, in place, with no streamed `fallback` and no swap (as the Pages Router renders it). The response
  waits for the remote, up to the island timeout (`timeoutMs`); a failure or timeout renders `errorFallback` in place
  and the page answers `200`. The route has no static shell: `next build` shows it as `ƒ`. With `cacheComponents` the
  page must export `instant = false`, or `next build` fails with Next's "runtime data during prerendering" error;
  without `cacheComponents` it needs nothing (Next refuses `instant` there). A `loading.tsx` or `<Suspense>` above the
  island streams it again. Guide: [App Router](https://github.com/tariqule/next-federation/blob/main/docs/guides/getting-started-app-router.md#private-content-in-the-first-html-blocking).
- `errorFallback` (default: `fallback`) is shown when the remote fails, times out or returns an invalid
  envelope, for an anonymous visitor on a private island, and after an uncaught island error. When the
  island's code cannot load in the browser (`NF-011`: remote down, build retired), an `errorFallback`
  you passed replaces the island; without one, the server HTML stays, not interactive.
- A `RemoteIsland` inside your own `'use cache'` scope (with `cacheComponents`): a failed island (or one
  showing its last good envelope) also applies the failure profile to that enclosing scope (`cacheLife()`
  keeps the shortest call in a scope, even against an explicit long `cacheLife` there), so the failure is
  retried within seconds instead of being cached for the scope's lifetime. Put such a cached component
  inside `<Suspense>`.
- `preloadIsland(spec)` starts the load early (e.g. in a layout); a `RemoteIsland` with an equal spec in the
  same request reuses it. It never throws or rejects: it swallows errors, and the matching `RemoteIsland`
  render rethrows them. A Next control-flow error (e.g. a `redirect()` inside `getIdentity`) is therefore
  lost only when no matching `RemoteIsland` renders in that request.
- Island events: `island:fetch` / `island:error` are emitted once per real fetch. With `cacheComponents` a
  cache hit emits nothing; without it, a Next data-cache hit still runs the request code and is emitted with
  its own (short) duration.
- `revalidateIsland(remote, island?)` expires `nf:<remote>` or `nf:<remote>:<island>` immediately
  (`revalidateTag(tag, { expire: 0 })`), e.g. from a remote-deploy webhook. `NF-001` for an unknown remote.

## `createPagesIslands`, `getIslandProps`, `RemoteIsland` (Pages Router)

```ts
// lib/federation.ts (imported only from getServerSideProps, getStaticProps and API routes)
import { createPagesIslands } from '@next-federation/next/pages/server'

export const { getIslandProps } = createPagesIslands(federation, {
  getIdentity, // the same PagesIdentity function as the API route: (req) => identity | null
})
```

```tsx
// pages/product.tsx
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'

export const getServerSideProps = async (ctx) => ({
  props: { cart: await getIslandProps(ctx, { remote: 'shop', island: 'Cart', props: { sku: 'A1' } }) },
})

export default function Product({ cart }: { cart: IslandProps }) {
  return <RemoteIsland {...cart} fallback={<p>Cart unavailable</p>} />
}
```

- `getIslandProps(ctx, spec)` returns `{ remote, envelope, host, token }` (plus `stale: true` for a last good
  envelope), JSON-serialisable (no `undefined`), to spread into `RemoteIsland`. `host` is `{ basePath, locale }`; `locale` is `''` for the default locale or no i18n.
- Public islands are fetched on every call. In `getStaticProps`, the page's own `revalidate` is the cache, so the
  page stays static (ISR). When the remote fails, `getIslandProps` returns the island's last good envelope with
  `stale: true` (stale-if-error, above), or `envelope: null` without one; either is kept for the whole
  `revalidate` window, so regenerate soon:

  ```ts
  export const getStaticProps = async (ctx) => {
    const banner = await getIslandProps(ctx, { remote: 'shop', island: 'Banner' })
    return { props: { banner }, revalidate: banner.envelope && !banner.stale ? 60 : 5 }
  }
  ```

- `private: true` works in `getServerSideProps` only (`NF-002` from `getStaticProps`, which has no request). It
  calls `getIdentity(ctx.req)` and mints the token on the server. The token goes only into the request to the remote.
  The page props carry only the token endpoint and an opaque per-user key. It needs `getIdentity` and `identity` in
  `defineFederation()` (`NF-013`).
- A failed, slow or invalid island, and an anonymous visitor on a private island, give `envelope: null`. The failure
  emits `island:error` and is logged with its NF code. Caller mistakes throw (`NF-001` unknown remote, `NF-009` props
  not JSON, `NF-017` missing `withNextFederation`).
- `RemoteIsland` (safe to import in page components) renders `errorFallback ?? fallback` when `envelope` is null.
  Otherwise it mounts the island. `IslandMount` renders the island's CSS as React stylesheet links
  (`precedence="next-federation"`, once per href): the server HTML has them ahead of the island, and nothing goes
  through `next/head`. Island links navigate through `next/router`. `push()` adds `basePath` and the locale itself, so the bridge
  passes it the bare path and the locale from the island's href, with no doubled prefix. With i18n, an href without
  a locale prefix goes to the default locale (as a hard load of that href would), not the current one.

## JWKS and token routes

A library cannot add routes to your `app/`, so you create them. Both routers use the same core: `GET jwks`
(public keys only, `Cache-Control: public, max-age=300`) and `POST token?aud=<remote>` (`{ token, expiresAt,
identityKey }`, `Cache-Control: no-store`). Everything else, and every request when `identity` is not
configured, is `404`.

```ts
// app/api/next-federation/[...nf]/route.ts  (App Router)
import { createFederationRoutes } from '@next-federation/next/routes'
import { federation } from '@/federation'

export const { GET, POST } = createFederationRoutes(federation, {
  getIdentity: async ({ cookies }) => {
    const session = cookies.get('session')?.value
    return session ? { sub: await userIdFor(session) } : null
  },
})
```

```ts
// pages/api/next-federation/[...nf].ts  (Pages Router)
import { createFederationApiHandler } from '@next-federation/next/pages/server'
import { federation } from '@/federation'

export default createFederationApiHandler(federation, {
  getIdentity: (req) => (req.cookies.session ? { sub: userIdFor(req.cookies.session) } : null),
})
```

The token endpoint authenticates with your own same-origin session through `getIdentity`; the library never
reads or sets a cookie. No session (an anonymous visitor): `200 {"token":null}`, so the island sends its
requests without `Authorization` (hosts before this release answered `401`, which the island client still
accepts). `aud` not a configured remote or missing: `400`. A request whose
`Sec-Fetch-Site` header is present and not `same-origin`: `403` (`getIdentity` is not called).

Startup validation: creating the routes calls `validateIdentity(federation)`, so a malformed signing key
is logged with its `NF-002` code when the route module loads. To fail the server boot instead, also call
`await validateIdentity(federation)` (from `@next-federation/core/identity`) in `instrumentation.ts`
`register()`.

Key rotation: pre-publish the new key as a non-first entry of `identity.signingKeys`, wait at least 10
minutes, then move it first. See [Key rotation](../server/README.md#key-rotation).

### Security notes

`aud` scopes a token to one remote's **server**, but island scripts run in the host origin, so any island on
the page can request a token for any configured remote. `aud` is not isolation between remotes in the
browser. Tokens are minted only for configured remotes, are never logged, and token responses are never
cached.

## Remote components: `getComponentDescriptor` (both routers)

```tsx
// App Router (Server Component)
import { getComponentDescriptor } from '@next-federation/next/server'
const descriptor = await getComponentDescriptor(federation, 'shop')
return <Cart descriptor={descriptor} items={3} /> // Cart: createRemoteComponent in a 'use client' file

// Pages Router (getServerSideProps / getStaticProps)
import { getComponentDescriptor } from '@next-federation/next/pages/server'
return { props: { descriptor: await getComponentDescriptor(federation, 'shop') } }
```

Resolves which build of a components remote this render uses (fetches the remote's
`/_nf/components.json`) and verifies it against `remotes.<name>.components.ssr`: only a signed or
pinned build keeps `ssr` (server rendering); every other build renders in the browser only
(`NF-028` once per build, `NF-027` for a bad signature or digest). The descriptor fetch is cached
through the island-cache alias: `next: { revalidate, tags: ['nf:<remote>'] }` without
`cacheComponents`, `'use cache'` + `cacheLife({ stale: 300, revalidate, expire: max(3600, 2 ×
revalidate) })` with it (a failure gets the failure profile above: retried within seconds, the page stays static). `{ dynamic: true }` fetches with
`cache: 'no-store'` (inside `<Suspense>` with `cacheComponents`: a PPR hole). There is no
in-process cache and no wall-clock read; when the remote is down the last known descriptor is
returned, and `null` (render the fallback) when none was ever fetched. Events:
`component:descriptor`, `component:error`. `@next-federation/next/pages/server` also re-exports
`preloadRemoteComponent`. Guide: [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components.md).

## Remote components with the host's `next/*` modules

```tsx
'use client'
// App Router: next/link and next/navigation. Pages Router: '@next-federation/next/pages/components'
// (next/link and next/router).
import { createRemoteComponent } from '@next-federation/next/components'

export const NavMenu = createRemoteComponent({ expose: './NavMenu', fallback: null })
```

These two `'use client'` entries are `@next-federation/react/components` (same exports, without
`fetchDescriptorInBrowser`) plus the host's own Next.js modules, registered as shared modules for
every remote component in the layer that imports them: `next/link` and `next/navigation` in the
App Router, `next/link` and `next/router` in the Pages Router. A remote that lists them in its
`shared` then renders the host's `<Link>` and reads the host's router, so links navigate on the
client and keep the host's `basePath` and locale. A remote component that imports a module the host
does not provide (for example `next/router` in an App Router host) renders its fallback
(`NF-036`). The version they report is the host's Next.js version, which `withNextFederation`
records in `env.NF_NEXT_VERSION` (`NF-017` without the wrapper).

## Remote component prop types: `nf-types`

```sh
nf-types --config lib/federation.config.ts [--remote shop]... [--out next-federation-types]
```

`--config` is the federation file with no Next.js imports (`lib/federation.config.ts` in the
guides), loaded with plain Node. `nf-types` does not read `.env.local`; load it with Node (`cli.js`
is what the `nf-types` bin runs):

```sh
node --env-file=.env.local node_modules/@next-federation/next/dist/types/cli.js \
  --config lib/federation.config.ts
```

Downloads the type declarations of each components remote's current build (only from a descriptor
that verifies with the remote's `components.ssr` keys or pins, only from under its base, through
the build's signed declarations index, each file's raw bytes checked against its sha384 and every
body read with a size limit; nothing downloaded runs) into `next-federation-types/<remote>/`, and
writes `next-federation-types/index.d.ts`, which fills `RemoteProps`:
`createRemoteComponent<RemoteProps<'shop', './Cart'>>({ expose: './Cart' })`. Exits 1 when a remote
fails (it keeps its previous types); a remote whose current (verified) build publishes no types
loses its previous ones and its `index.d.ts` entry. Guide: [Types](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components.md#types).

## API

| Export                                                    | Entry                                                                        | Purpose                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `withNextFederation(config)`                              | `@next-federation/next/config`                                               | Required config wrapper.                                          |
| `createIslands(federation, { getIdentity? })`             | `@next-federation/next/server`                                               | `RemoteIsland`, `preloadIsland`, `revalidateIsland` (App Router). |
| `createFederationRoutes(federation, { getIdentity })`     | `@next-federation/next/routes`                                               | JWKS and token route handlers (App Router).                       |
| `createPagesIslands(federation, { getIdentity? })`        | `@next-federation/next/pages/server`                                         | `getIslandProps` (Pages Router, server only).                     |
| `createFederationApiHandler(federation, { getIdentity })` | `@next-federation/next/pages/server`                                         | JWKS and token API route (Pages Router).                          |
| `RemoteIsland`, `IslandProps`                             | `@next-federation/next/pages`                                                | Render an island in a page component.                             |
| `getComponentDescriptor(federation, remote, options?)`    | `@next-federation/next/server`, `@next-federation/next/pages/server`         | Remote components: the build to render, for `RemoteComponent`.    |
| `createRemoteComponent`, `registerSharedModules`, …       | `@next-federation/next/components`, `@next-federation/next/pages/components` | Remote components with the host's `next/*` modules.               |

`@next-federation/next/island-cache` and its `/legacy` and `/cache-components` variants are internal:
`withNextFederation` aliases them.

## Constraints

- Next.js `>=15.5.28 <17` (16 or 15), React 19, Turbopack or webpack, Node 20.9 or newer. On Next 15
  the island cache is the legacy one; `cacheComponents` is Next 16 only (`NF-002` on Next 15).
  Next 14 is not supported.
- Private islands make an App Router route dynamic without `cacheComponents`; with `blocking` they make it dynamic (`ƒ`) with `cacheComponents` too, and the page needs `export const instant = false`. Pages Router private islands are `getServerSideProps` only (`NF-002`).
- A `'use cache'` component around `RemoteIsland` must sit inside `<Suspense>`.
- A Next app does not expose its `app/` folder: to share UI from one, publish an island remote.

## Learn more

- [App Router guide](https://github.com/tariqule/next-federation/blob/main/docs/guides/getting-started-app-router.md)
- [Pages Router guide](https://github.com/tariqule/next-federation/blob/main/docs/guides/getting-started-pages-router.md)
- [Caching](https://github.com/tariqule/next-federation/blob/main/docs/guides/caching.md)
- [Identity](https://github.com/tariqule/next-federation/blob/main/docs/guides/identity.md)
- [CSP](https://github.com/tariqule/next-federation/blob/main/docs/guides/csp.md)
- [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components.md)
- [Sharing components from a Next app](https://github.com/tariqule/next-federation/blob/main/docs/guides/sharing-components-from-a-next-app.md)

License: MIT
