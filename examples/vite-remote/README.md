# example-vite-remote

An **island remote** built with `@next-federation/vite`. It renders React Server Components on its
own server and answers island requests from the example hosts.

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
  (3301-3303), `issuers` the hosts whose tokens it accepts, with their JWKS URLs (the Pages Router
  host's issuer includes its basePath `/shop`).
- `src/islands/*.tsx`: one entry per island (a Server Component with a default export).

Guide: [Writing an island remote](../../docs/guides/writing-an-island-remote.md).
