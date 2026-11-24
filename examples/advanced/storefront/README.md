# example-storefront

**Host** (Next.js 16, App Router with `cacheComponents` and Pages Router routes in one app,
`basePath: '/store'`, English and French). Embeds islands from the [CDP](../cdp-remote/README.md),
[PDP](../pdp-remote/README.md), [SERP](../serp-remote/README.md) and
[Account](../account-remote/README.md) remotes and components from the
[Header remote](../header-remote-rspack/README.md) (Rspack). Port 13410.

What it shows, by route:

| Route                    | Router | Configured as                      | What to notice                                                                                                           |
| ------------------------ | ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/store/en`, `/store/fr` | App    | ◐ static shell + streamed parts    | CDP islands prerendered in the shell; the header's private `AccountBadge` streams in per request.                        |
| `/store/en/c/[category]` | App    | ◐                                  | The CDP grid with a per-island `revalidate` of 10 minutes.                                                               |
| `/store/en/p/[sku]`      | App    | ◐                                  | PDP islands and the `AddToCart` remote component in the shell; the private `ForYou` island streams in.                   |
| `/store/en/search?q=`    | App    | ◐                                  | `?q=` is per request, so `SearchResults` (SERP) streams in; its envelope is cached per query.                            |
| `/store/en/account`      | App    | ƒ (`export const instant = false`) | `Profile` and `Orders` are `blocking` private islands: in the first HTML, in place, no loading state.                    |
| `/store/admin`           | Pages  | ƒ (`getServerSideProps`)           | The same header components and `ProductGrid` island on the Pages Router; the admin-only `Inventory` island; **Publish**. |

Files:

- `lib/federation.config.ts`: `defineFederation` with the five remotes, the trusted public key of
  the Header remote's builds, and the identity issuer (`<origin>/store`). No Next.js imports, so
  both routers (and tools like `nf-types`) can load it.
- `lib/federation.ts` (App Router) and `lib/pages-federation.ts` (Pages Router): `createIslands`,
  `createPagesIslands` and the token routes, with the same `getIdentity`.
- `lib/session.ts`: **demo only**, a sign-in with two plain cookies (name and role, no password).
  `getIdentity` returns `{ sub, claims: { name, role } }`; each private island's token carries them,
  minted for that island's remote only.
- `lib/header.app.tsx` and `lib/header.pages.tsx`: the Header remote's components, bound once per
  router (`@next-federation/next/components` and `@next-federation/next/pages/components`). Each
  router has its own React and its own remote component runtime. `lib/header-shared.ts` lists the
  modules this host passes: the cart and session contexts and its design system copy.
- `app/api/publish/route.ts`: `revalidateIsland('cdp')` and `revalidateIsland('pdp')`, for admins.
  In production, call such a route from the remotes' deploy pipeline, with its own secret.
- `app/api/next-federation/[...nf]/route.ts`: the JWKS and token routes, used by both routers.
- `example-inspect` (`Embedded`, `PagePanel`, `ARRIVALS_SCRIPT` in the layout and `pages/_document.tsx`):
  demo only. The outlines, tags and the **How is this page built?** layer. Leave them out of your app.

Links between the App Router and Pages Router routes (to and from **Admin**) reload the page: that is
how Next.js links its two routers. The cart is React state, so it starts empty after such a reload.

## Run it

Part of the [commerce platform](../README.md): `pnpm examples:platform` from the repository root
builds and starts it with the five remotes. Then open <http://localhost:13410/store/en> and follow
the [walkthrough](../README.md#walkthrough); on each page, turn on **How is this page built?** to
see what was prerendered, what streamed in, what is blocking, which router served the route, and
which remote build rendered each piece.

Alone: `pnpm examples:keys` once, start the remotes (their READMEs), then
`pnpm --filter example-storefront build` and `start` (or `dev`). `next build` prerenders pages from
the remotes, so start them first.

Guides: [App Router host](../../../docs/guides/getting-started-app-router.mdx),
[Caching](../../../docs/guides/caching.mdx), [Identity](../../../docs/guides/identity.mdx),
[Mixed-router hosts](../../../docs/guides/remote-components/security.mdx#mixed-router-hosts).
