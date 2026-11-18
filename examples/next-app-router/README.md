# example-next-app-router

A Next.js 16 App Router host on port 3301.

- `/` and `/products/[sku]` (`lib/ProductPage.tsx`): two public islands from the island remote
  (`ProductPanel`, `Links`), server-rendered and cached by the host, and the `CartButton` client
  component from the components remote, server-rendered here and hydrated (`lib/RemoteCartButton.tsx`
  and `lib/CartButton.tsx`). The header's cart count is host state the remote component updates.
- `/orders`: the private `MyOrders` island, for the signed-in user.
- `lib/federation.ts`: `defineFederation` (both remotes, identity), `createIslands` and the token
  routes, mounted at `app/api/next-federation/[...nf]/route.ts`.
- `app/api/session/route.ts`: demo-only sign-in (any name, a plain cookie, no password).
  Replace it with your real authentication; the library only needs `getIdentity`.

## Run it

From the repository root (`pnpm install` and `pnpm build` first):

```sh
pnpm examples:dev       # this host, both remotes and the other hosts
```

Then open <http://localhost:3301>. Alone: `pnpm examples:keys` once, start both remotes (see their
READMEs), then `pnpm --filter example-next-app-router dev` (or `build` and `start`). Without the
remotes the page still answers, with the fallbacks.

## Deploy on Vercel

`vercel.json` builds the workspace packages, then `next build`. Environment variables: `SHOP_ORIGIN`
and `CART_ORIGIN` (the remotes' URLs), `APP_ROUTER_ORIGIN` (this host's URL: the identity issuer
the island remote lists), `NF_SIGNING_KEY` (private, this project only) and
`NF_COMPONENTS_PUBLIC_KEY`. Without them, the local defaults apply. On Vercel, the header shows a
live demo banner (`NEXT_PUBLIC_VERCEL_ENV` is set at build time).

Guides: [App Router host](../../docs/guides/getting-started-app-router.md),
[Identity](../../docs/guides/identity.md), [Remote components](../../docs/guides/remote-components.md).
