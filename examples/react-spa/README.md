# example-react-spa

A client-only React app (Vite) on port 3303 that uses **both remotes**:

- `src/ProductPanel.tsx`: fetches the `ProductPanel` island envelope in the browser (CORS: the
  island remote lists `http://localhost:3303` in `hosts`) and mounts it with `IslandMount`, which
  also loads the island's stylesheets.
- `src/CartButton.tsx`: the `CartButton` client component, from `fetchDescriptorInBrowser`. An SPA
  has no server, so it always renders in the browser (no keys needed).
- `src/main.tsx`: the host's `CartProvider`; the remote button updates the header's count.

There is no server render: the island's HTML appears once its envelope arrives. Private islands
need a server to sign tokens and are not shown here.

## Run it

From the repository root (`pnpm install` and `pnpm build` first):

```sh
pnpm examples:dev       # this app, both remotes and the other hosts
```

Then open <http://localhost:3303>. Alone: start both remotes (see their READMEs), then
`pnpm --filter example-react-spa dev` (or `build` and `start`, which runs `vite preview`).

Guides: [SPA host](../../docs/guides/getting-started-spa.md),
[Client components](../../docs/guides/client-components.md).
