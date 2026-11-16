# Examples

Small apps you can copy. Two remotes serve UI, three hosts embed it:

| Folder                                    | What it is                                                         | Port               |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| [`vite-remote`](vite-remote/)             | Island remote (Vite): `ProductPanel`, `Links`, private `MyOrders`  | 3300 (`127.0.0.1`) |
| [`components-remote`](components-remote/) | Client-components remote (Mode A, Vite): `CartButton`              | 3304 (`127.0.0.1`) |
| [`next-app-router`](next-app-router/)     | Next.js App Router host                                            | 3301 (`localhost`) |
| [`next-pages-router`](next-pages-router/) | Next.js Pages Router host, `basePath: '/shop'`, English and French | 3302 (`localhost`) |
| [`react-spa`](react-spa/)                 | Client-only React host (Vite)                                      | 3303 (`localhost`) |
| [`cart-context`](cart-context/)           | The React context the hosts share with `CartButton`                | (a package)        |

Hosts are opened as `localhost` and remotes as `127.0.0.1`, so a host and a remote are different
sites, as in production. Ports 3300-3304 must be free.

## Run them all

From the repository root, after `pnpm install` and `pnpm build`:

```sh
pnpm examples:dev
```

This writes demo keys if they are missing (`pnpm examples:keys`, below), builds the components
remote, starts every app, and prints the URLs. Ctrl-C stops everything. Hosts and the island remote
run their dev servers; the components remote is always a build, because hosts server-render client
components from a build only.

`pnpm examples:start` does the same with production builds (`vite build` + `nf-serve`,
`next build` + `next start`, `vite build` + `vite preview`).

## What to click

- **<http://localhost:3301>** (App Router). The product panel is an island: the remote rendered it on
  its server, and this page has its HTML (turn JavaScript off: it is still there). Its `−`/`+`
  buttons are a client component of the island. **Add A1 to cart** comes from the other remote: a
  client component, server-rendered here too, that updates the host's own cart count in the header.
  The links under **More products** are an island too: clicking one navigates the host without a
  reload (the cart count stays).
- **<http://localhost:3301/orders>**: sign in with any name. **My orders** is a private island: the
  host signs a short-lived token for the remote, and the remote renders the orders of that user.
- **<http://localhost:3302/shop/fr>** (Pages Router, French). The heading is the host's; the price
  format comes from the locale the host passes to the island; island links point to
  `/shop/fr/products/…` (basePath and locale added for you). The header switches language.
- **<http://localhost:3303>** (SPA). Both remotes in a client-only app: the browser fetches the
  island and the client component.
- **A redeploy** while a tab stays open: `pnpm examples:walkthrough` (step f) builds the island
  remote again and restarts its `nf-serve`. The open tab keeps working, and the next island it
  mounts comes from the new build, in the same page (each panel prints the build that rendered it).
  `nf-serve` keeps serving the older builds, so pages rendered before the deploy still load them.

## Keys (demo only)

`pnpm examples:keys` writes git-ignored `.env.local` files:

- `next-app-router/.env.local` and `next-pages-router/.env.local`: `NF_SIGNING_KEY`, the host's
  private identity key (it signs the tokens of private islands), and `NF_COMPONENTS_PUBLIC_KEY`, the
  key the host trusts to server-render the components remote.
- `components-remote/.env.local`: `NF_COMPONENTS_SIGNING_KEY`, the private key its builds are
  signed with.

Never commit them. In production, keep each private key in a secret store (see
[Identity](../docs/guides/identity.md) and [Client components](../docs/guides/client-components.md)).
`pnpm examples:keys --force` replaces them.

## Checks

- `pnpm examples:smoke` builds and starts everything, then checks the remote's `/_nf/health`, the
  host pages' island HTML (signed out and signed in) and the server-rendered client component. CI
  runs it (`examples-smoke` job).
- `pnpm examples:walkthrough` does the same, then drives the apps in Chromium (the repo's
  Playwright in `test/e2e`), including a redeploy of the island remote, and saves screenshots to
  [`docs/examples/screenshots/`](../docs/examples/screenshots/).

App logs of both go to `examples/.logs/`.

## Copying an example

The examples import only published entry points (`@next-federation/*`), linked from this repository
with `workspace:*`. In your own app, use version ranges instead, and replace the hard-coded
`localhost` origins with your own. Each remote keeps every build in `dist/<buildId>/`; delete old
folders when you no longer need them.
