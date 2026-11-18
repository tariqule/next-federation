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
  of the browser bundle. The identity issuer includes the basePath.
- `pages/api/session.ts`: demo-only sign-in (any name, a plain cookie, no password).

## Run it

From the repository root (`pnpm install` and `pnpm build` first):

```sh
pnpm examples:dev       # this host, both remotes and the other hosts
```

Then open <http://localhost:3302/shop/fr>. Alone: `pnpm examples:keys` once, start both remotes (see
their READMEs), then `pnpm --filter example-next-pages-router dev` (or `build` and `start`).

Guides: [Pages Router host](../../docs/guides/getting-started-pages-router.md),
[Identity](../../docs/guides/identity.md), [Remote components](../../docs/guides/remote-components.md).
