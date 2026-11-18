# Examples

Small apps you can copy: two **remotes** serve UI, three **hosts** embed it. A host is the app
users open; a remote has no UI of its own and serves pieces of UI that hosts render at runtime,
without rebuilding the host. Each folder has its own README with what it shows, how to run it and
the guide that explains it.

There are two kinds of remote, one per way to embed UI:

- **Islands** (`vite-remote`): the remote renders React Server Components on its own server and
  sends HTML. The host places it on the page; the island keeps its own React.
- **Remote components** (`components-remote`): the host loads the remote's client components and
  renders them in its own React tree, so they can read the host's React context.

```text
┌──────────────────────────────────────────────────────────────────┐
│ REMOTE  vite-remote (remote name "shop", Vite)                   │
│ serves islands: ProductPanel, Links, MyOrders                    │
└──────────┬──────────────────────┬──────────────────────┬─────────┘
           │ islands              │ islands              │ island
           ▼                      ▼                      ▼
┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
│ HOST               │ │ HOST               │ │ HOST               │
│ next-app-router    │ │ next-pages-router  │ │ react-spa          │
│ ProductPanel       │ │ ProductPanel       │ │ ProductPanel       │
│ Links, MyOrders    │ │ Links, MyOrders    │ │                    │
│ CartButton         │ │ CartButton         │ │ CartButton         │
└────────────────────┘ └────────────────────┘ └────────────────────┘
           ▲                      ▲                      ▲
           │ remote               │ remote               │ remote
           │ component            │ component            │ component
┌──────────┴──────────────────────┴──────────────────────┴─────────┐
│ REMOTE  components-remote (remote name "cart", Vite)             │
│ exposes a remote component: CartButton                           │
└──────────────────────────────────────────────────────────────────┘
```

| App                                       | Role   | What it provides or embeds                                                                  | Mechanism                     | Live URL                                                       | Local port         |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------- | ------------------ |
| [`vite-remote`](vite-remote/)             | Remote | Provides the islands `ProductPanel`, `Links` and `MyOrders` (private), as remote `shop`     | Islands                       | <https://next-federation-example-vite-remote.vercel.app>       | 3300 (`127.0.0.1`) |
| [`components-remote`](components-remote/) | Remote | Provides the client component `./CartButton`, as remote `cart`                              | Remote components             | <https://next-federation-example-components-remote.vercel.app> | 3304 (`127.0.0.1`) |
| [`next-app-router`](next-app-router/)     | Host   | Next.js App Router. Embeds `ProductPanel`, `Links`, `MyOrders` and `CartButton`             | Both, server-rendered         | <https://next-federation-example-app-router.vercel.app>        | 3301 (`localhost`) |
| [`next-pages-router`](next-pages-router/) | Host   | Next.js Pages Router, `basePath: '/shop'`, English and French. Embeds the same four         | Both, server-rendered         | <https://next-federation-example-pages-router.vercel.app/shop> | 3302 (`localhost`) |
| [`react-spa`](react-spa/)                 | Host   | Client-only React (Vite). Embeds `ProductPanel` and `CartButton`                            | Both, rendered in the browser | <https://next-federation-example-react-spa.vercel.app>         | 3303 (`localhost`) |
| [`cart-context`](cart-context/)           | Shared | Not an app: the React context the hosts share with `CartButton` (`CartProvider`, `useCart`) | Shared module                 | (none)                                                         | (a package)        |

In the running apps, each host says under its header that it is a host, and each embedded piece
has a dashed outline with a small tag naming the remote it comes from. The labels are host markup
around the island or component, never inside it. The remotes' live URLs show a short page that
says what they serve (on Vercel only; locally `nf-serve` answers `/` with `404`).

Hosts are opened as `localhost` and remotes as `127.0.0.1`, so a host and a remote are different
sites, as in production. Ports 3300-3304 must be free.

## Live demo

The same five apps run on Vercel, deployed from `main`. Try them without cloning:
[the live demo page](https://next-federation-docs.vercel.app/docs/live-demo) lists every app, its
role and what to try. The URLs are in the table above; a remote also answers its health check or
descriptor:

- Island remote: <https://next-federation-example-vite-remote.vercel.app/_nf/health>
- Components remote: <https://next-federation-example-components-remote.vercel.app/_nf/components.json>

[What to click](#what-to-click) applies there too, with these URLs (the redeploy step is local
only). The sign-in is a demo: any name, no password, and the orders it shows are made up. Each
project's `vercel.json` holds its install and build commands; the island remote is deployed as in
[Deploying an island remote on Vercel](../docs/guides/deploying-a-remote-on-vercel.md).
Maintainers: [docs/maintainers/live-demo.md](../docs/maintainers/live-demo.md).

## Run them all

From the repository root, after `pnpm install` and `pnpm build`:

```sh
pnpm examples:dev
```

This writes demo keys if they are missing (`pnpm examples:keys`, below), builds the components
remote, starts every app, and prints the URLs. Ctrl-C stops everything. The hosts and the island remote
run their dev servers; the components remote is always a build, because hosts server-render client
components from a build only.

`pnpm examples:start` does the same with production builds (`vite build` + `nf-serve`,
`next build` + `next start`, `vite build` + `vite preview`).

## What to click

- **<http://localhost:3301>** (App Router host). The product panel is an island from `vite-remote`:
  the remote rendered it on its server, and this page has its HTML (turn JavaScript off: it is still there). Its `−`/`+`
  buttons are a client component of the island. **Add A1 to cart** is a remote component from `components-remote`:
  a client component, server-rendered here too, that updates the host's own cart count in the header.
  The links under **More products** are an island too: clicking one navigates the host without a
  reload (the cart count stays).
- **<http://localhost:3301/orders>** (App Router host): sign in with any name. **My orders** is a
  private island from `vite-remote`: the
  host signs a short-lived token for the remote, and the remote renders the orders of that user.
- **<http://localhost:3302/shop/fr>** (Pages Router host, French). The heading is the host's; the price
  format comes from the locale the host passes to the island; island links point to
  `/shop/fr/products/…` (basePath and locale added for you). The header switches language.
- **<http://localhost:3303>** (SPA host). Both remotes in a client-only app: the browser fetches the
  `ProductPanel` island and the `CartButton` remote component. It has no server, so no private
  island.
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
[Identity](../docs/guides/identity.md) and [Remote components](../docs/guides/remote-components.md)).
`pnpm examples:keys --force` replaces them.

`pnpm examples:demo-keys` prints new keys and the URLs as the environment variables of each live demo
project, and writes nothing to disk ([docs/maintainers/live-demo.md](../docs/maintainers/live-demo.md)).

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
with `workspace:*`. In your own app, use version ranges instead. The origins default to the local
ports above; set them with environment variables (`SHOP_ORIGIN`, `CART_ORIGIN`, `APP_ROUTER_ORIGIN`,
`PAGES_ROUTER_ORIGIN`, `SPA_ORIGIN`; `VITE_SHOP_ORIGIN` and `VITE_CART_ORIGIN` in the SPA), as the
live demo does (on Vercel a missing one fails the build). Each remote's `base` is its own URL: on
Vercel, the build reads it from `NF_PUBLIC_ORIGIN`, else `VERCEL_PROJECT_PRODUCTION_URL`. Each
remote keeps every build in `dist/<buildId>/`; delete old folders when you no longer need them.
