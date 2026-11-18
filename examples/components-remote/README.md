# example-components-remote

**Remote** (remote components, Vite, remote name `cart`). Exposes the client component
`./CartButton`, which the three hosts render. It has no UI of its own.
Live: <https://next-federation-example-components-remote.vercel.app>.

A components remote built with `nextFederationComponents` from
`@next-federation/vite`. It exposes one component, `./CartButton`, that hosts load at runtime and
render inside their own React tree: it runs on the host's React and reads the host's cart through
the shared [`example-cart-context`](../cart-context/README.md) module.

The Next.js example hosts server-render it, then hydrate it. The SPA renders it in the browser.

## Run it

From the repository root (`pnpm install` and `pnpm build` first):

```sh
pnpm examples:keys                                  # once: demo signing keys (.env.local)
pnpm --filter example-components-remote build       # dist/<buildId>/, signed descriptor
pnpm --filter example-components-remote start       # nf-serve on 3304
```

Check it: <http://127.0.0.1:3304/_nf/components.json> (the current build's descriptor).
`pnpm examples:dev` and `pnpm examples:start` do all of this for you.

## Signing (why the hosts trust it)

Server rendering runs the remote's server code inside the host's server process, so a host
evaluates only builds it can verify. Each build writes `nf-components.json` with the sha384 of every
server file; when `NF_COMPONENTS_SIGNING_KEY` (a private EC P-256 JWK) is set at build time, the
descriptor is signed with it (ES256). The hosts list the matching public key in
`components.ssr.publicKeys`.

- Here the key is a demo key in the git-ignored `.env.local` (`pnpm examples:keys`).
  `vite.config.ts` copies it to `process.env`, because Vite does not do that for `.env` files.
- In production set `NF_COMPONENTS_SIGNING_KEY` as a secret of the remote's build (CI) only; it
  never leaves the build. Give hosts the public key.
- Pinning instead of signing: each build's `dist/<buildId>/nf-components.json` has a `digest`;
  a host can allow exact builds with `components.ssr.pinned: { '<buildId>': '<digest>' }`.

Without a trusted key or pin, hosts render the component in the browser only (and log `NF-028`).

## Deploy on Vercel

Static files only. `vercel.json` runs `scripts/vercel-build.ts` (production deployments only):
`vite build` with `NF_VERCEL=1` (`base` from `NF_PUBLIC_ORIGIN`, this remote's https origin; else
`VERCEL_PROJECT_PRODUCTION_URL`), then the layout `nf-serve` serves: `b/<buildId>/*` and
`_nf/components.json`, plus `index.html` at `/` (`landing/index.html`: a page that says this is a
remote and what it exposes; locally `nf-serve` answers `/` with `404`). Set `NF_COMPONENTS_SIGNING_KEY` on this project only; the script fails
without it, so a deployment is always signed. Hosts get the public key as `NF_COMPONENTS_PUBLIC_KEY`.

Guide: [Remote components](../../docs/guides/remote-components.md) (integrity, rotation, limits).
