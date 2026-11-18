# example-next-pages-router

A Next.js 16 Pages Router host on port 3302, with `basePath: '/shop'` and the locales `en`
(default) and `fr`.

- `/shop`, `/shop/fr`, `/shop/products/[sku]` (`lib/ProductPage.tsx`, props from
  `lib/product-props.ts`): the `ProductPanel` and `Links` islands from `getIslandProps` in
  `getServerSideProps`, and the `CartButton` client component from `getComponentDescriptor`,
  server-rendered and hydrated. The host passes its locale to `ProductPanel` as a prop (React
  context does not cross into an island); island links get `/shop` and `/fr` added for you.
- `/shop/orders`: the private `MyOrders` island. The token is minted and used in
  `getServerSideProps`; the page props carry the rendered envelope only.
- `lib/federation.ts`: imported from `getServerSideProps` and API routes only, so Next keeps it out
  of the browser bundle. The identity issuer includes the basePath. The guides keep
  `defineFederation` in a separate `lib/federation.config.ts` so `nf-types` can load it; this
  example does not run `nf-types`, so it keeps everything in one file.
- `pages/api/session.ts`: demo-only sign-in (any name, a plain cookie, no password).

## Run it

From the repository root (`pnpm install` and `pnpm build` first):

```sh
pnpm examples:dev       # this host, both remotes and the other hosts
```

Then open <http://localhost:3302/shop/fr>. Alone: `pnpm examples:keys` once, start both remotes (see
their READMEs), then `pnpm --filter example-next-pages-router dev` (or `build` and `start`).

## Deploy on Vercel

`vercel.json` builds the workspace packages, then `next build`. Environment variables: `SHOP_ORIGIN`
and `CART_ORIGIN` (the remotes' URLs), `PAGES_ROUTER_ORIGIN` (this host's URL: the identity issuer
the island remote lists), `NF_SIGNING_KEY` (private, this project only) and
`NF_COMPONENTS_PUBLIC_KEY`. Locally, without them, the local defaults apply; on Vercel a missing one
fails the build. `vercel.json` builds production deployments only. On Vercel, the header shows a
live demo banner (`NEXT_PUBLIC_VERCEL_ENV` is set at build time).

Guides: [Pages Router host](../../docs/guides/getting-started-pages-router.md),
[Identity](../../docs/guides/identity.md), [Remote components](../../docs/guides/remote-components.md).
