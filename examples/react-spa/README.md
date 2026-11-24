# example-react-spa

**Host** (React SPA, Vite). Embeds the `ProductPanel` island from
[`vite-remote`](../vite-remote/README.md) and a remote component from
[`components-remote`](../components-remote/README.md), both in the browser.
Live: <https://next-federation-example-react-spa.vercel.app>.

A client-only React app (Vite) on port 3303 that uses both remotes:

- `src/ProductPanel.tsx`: fetches the `ProductPanel` island envelope in the browser (CORS: the
  island remote lists `http://localhost:3303` in `hosts`) and mounts it with `IslandMount`, which
  also loads the island's stylesheets.
- `src/CartButton.tsx`: the `CartButton` client component, from `fetchDescriptorInBrowser`. An SPA
  has no server, so it always renders in the browser (no keys needed).
- `src/main.tsx`: the host's `CartProvider`; the remote button updates the header's count.
- `src/Embedded.tsx`: demo only. The dashed outline and tag around each embedded piece, and the
  caption under the header, say which remote serves what. They wrap the island or component and
  never go inside it; leave them out of your app.

There is no server render: the island's HTML appears once its envelope arrives. Private islands
need a server to sign tokens and are not shown here.

## Run it

From the repository root (`pnpm install` and `pnpm build` first):

```sh
pnpm examples:dev       # this app, both remotes and the other hosts
```

Then open <http://localhost:3303>. Alone: start both remotes (see their READMEs), then
`pnpm --filter example-react-spa dev` (or `build` and `start`, which runs `vite preview`).

## Deploy on Vercel

`vercel.json` builds the workspace packages, then `vite build` (static output in `dist`). Set
`VITE_SHOP_ORIGIN` and `VITE_CART_ORIGIN` to the remotes' URLs; they are fixed at build time, and on
Vercel `vite.config.ts` fails the build without them. The island remote must list this app's URL in
`hosts` (its `SPA_ORIGIN`). `vercel.json` builds production deployments only. On Vercel, the page
shows a live demo banner (`VITE_VERCEL_ENV` is set at build time).

Guides: [SPA host](../../docs/guides/getting-started-spa.mdx),
[Remote components](../../docs/guides/remote-components/overview.mdx).
