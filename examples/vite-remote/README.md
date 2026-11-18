# example-vite-remote

**Remote** (island remote, Vite, remote name `shop`). Serves the islands `ProductPanel`, `Links`
and `MyOrders` to the three hosts. It has no UI of its own.
Live: <https://next-federation-example-vite-remote.vercel.app>.

An island remote built with `@next-federation/vite`. It renders React Server Components on its
own server and answers island requests from the example hosts:
[`next-app-router`](../next-app-router/README.md) and
[`next-pages-router`](../next-pages-router/README.md) embed all three islands,
[`react-spa`](../react-spa/README.md) embeds `ProductPanel`.

| Island         | Shows                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ProductPanel` | A public island: server data (`src/data.ts`, `server-only`), CSS, and a client child (`Quantity`). Takes `{ sku, locale }`. |
| `Links`        | `Link` from `@next-federation/island`: host-relative hrefs, host navigation without a reload.                               |
| `MyOrders`     | A private island (`private: true`): `getIdentity()` reads the user from the host's signed token.                            |

Every panel prints `remote build <id>`, so you can see which build rendered it after a redeploy.

## Run it

From the repository root (`pnpm install` and `pnpm build` first):

```sh
pnpm examples:dev                              # everything, see ../README.md
pnpm --filter example-vite-remote dev          # this remote only: Vite dev server on 3300
pnpm --filter example-vite-remote build        # dist/<buildId>/ (NF_BUILD_ID, else the time)
pnpm --filter example-vite-remote start        # nf-serve: every kept build, on 3300
```

Check it: <http://127.0.0.1:3300/_nf/health>.

## Files

- `vite.config.ts`: the plugin options. `hosts` lists the browser origins allowed to embed
  (3301-3303 unless set), `issuers` the hosts whose tokens it accepts, with their JWKS URLs (the
  Pages Router host's issuer includes its basePath `/shop`).
- `src/islands/*.tsx`: one entry per island (a Server Component with a default export).
- `landing/index.html`: the page at `/` on Vercel, which says this is a remote and what it serves.
  `scripts/vercel-build.ts` copies it to the static output. `nf-serve` serves no page at `/`, so
  locally `/` answers `404`.

## Deploy on Vercel

Static files plus one Vercel Function, as in
[Deploying an island remote on Vercel](../../docs/guides/deploying-a-remote-on-vercel.md):
`vercel.json` (install and build commands, rewrites, headers), `scripts/vercel-build.ts` (`vite build`
with `NF_VERCEL=1`, then the static output) and `api/nf.ts` (the Function). The build reads its
`base` from `NF_PUBLIC_ORIGIN` (this remote's https origin; else `VERCEL_PROJECT_PRODUCTION_URL`),
and the hosts' URLs from `APP_ROUTER_ORIGIN`, `PAGES_ROUTER_ORIGIN` and `SPA_ORIGIN` (`hosts` and
`issuers`); on Vercel a missing host URL fails the build. It needs no secret: it fetches each host's
public keys from its JWKS URL. `vercel.json` builds production deployments only.

Guide: [Writing an island remote](../../docs/guides/writing-an-island-remote.md).
