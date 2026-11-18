# Live demo

Five example apps from this repository run on Vercel: three hosts and two remotes. A host is the
app you open; a remote has no UI of its own and serves pieces of UI that the hosts render at
runtime. Open a host to see both remotes on its page. The demo deploys from `main`, so it always
runs the current code.

The two remotes show the two ways to embed UI:

- **Islands** (`vite-remote`): the remote renders React Server Components on its own server and
  sends HTML. The host places it on the page; the island keeps its own React.
- **Remote components** (`components-remote`): the host loads the remote's client components and
  renders them in its own React tree, where they read the host's React context.

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

| App                 | Role   | Runs on                | What it embeds or serves                                                                  | Live URL                                                       |
| ------------------- | ------ | ---------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `next-app-router`   | Host   | Next.js App Router     | Embeds the islands `ProductPanel`, `Links` and `MyOrders`, and the `CartButton` component | <https://next-federation-example-app-router.vercel.app>        |
| `next-pages-router` | Host   | Next.js Pages Router   | Embeds the same islands and component, under `basePath: '/shop'`, in English and French   | <https://next-federation-example-pages-router.vercel.app/shop> |
| `react-spa`         | Host   | Vite SPA               | Embeds the `ProductPanel` island and the `CartButton` component, in the browser only      | <https://next-federation-example-react-spa.vercel.app>         |
| `vite-remote`       | Remote | Vite island remote     | Serves the islands `ProductPanel`, `Links` and `MyOrders` (private), as the `shop` remote | <https://next-federation-example-vite-remote.vercel.app>       |
| `components-remote` | Remote | Vite components remote | Serves the remote component `./CartButton`, as the `cart` remote                          | <https://next-federation-example-components-remote.vercel.app> |

On each host, a line under the header says it is a host, and every embedded piece has a dashed
outline with a small tag naming the remote it comes from. The sign-in is a demo: any name, no
password, and the orders are made up.

## What to try

### App Router host

<https://next-federation-example-app-router.vercel.app>

- **The island's `−`/`+` buttons.** The product panel is an island: `vite-remote` rendered it on
  its server. The buttons are a client component of the island, hydrated in your browser.
- **Add A1 to cart.** A remote component from `components-remote`. It runs on the host's React and
  shares the host's cart context, so the cart count in the host's header goes up.
- **The island links.** The links under **More products** come from the `Links` island. Clicking
  one navigates the host without a page reload: the cart count stays.
- **The private island.** Open [`/orders`](https://next-federation-example-app-router.vercel.app/orders)
  and sign in with any name. The host signs a short-lived token for that name, and `vite-remote`
  renders the orders of that name ("Orders for ada") only with that token.
- **Server HTML.** Turn JavaScript off and reload: the product panel and the **Add A1 to cart**
  button are still there, because the host rendered both on its server.

### Pages Router host

<https://next-federation-example-pages-router.vercel.app/shop>

- **The French locale.** Open [`/shop/fr`](https://next-federation-example-pages-router.vercel.app/shop/fr):
  the heading is the host's (**Produit A1**), the price format comes from the locale the host passes
  to the island (**Prix**), and the island links point to `/shop/fr/products/…`, with the basePath
  and locale added for the island. The header switches language.
- **The island's `−`/`+` buttons**, **Add A1 to cart** and **the island links** work as on the App
  Router host.
- **The private island.** Open [`/shop/orders`](https://next-federation-example-pages-router.vercel.app/shop/orders)
  and sign in with any name.
- **Server HTML.** Turn JavaScript off and reload: the panel and the cart button are in the HTML
  from `getServerSideProps`.

### React SPA host

<https://next-federation-example-react-spa.vercel.app>

- **Both remotes in a client-only app.** The browser fetches the `ProductPanel` island and the
  `CartButton` component; there is no server render, so the panel appears once it arrives.
- **The island's `−`/`+` buttons** and **Add A1 to cart**, which updates the SPA's own cart count.
- An SPA has no server to sign tokens, so it shows no private island. With JavaScript off, the page
  is empty.

## The remotes

The remotes have no UI of their own. Each live URL shows a short page that says it is a remote,
what it serves and which hosts embed it.

- **vite-remote** (<https://next-federation-example-vite-remote.vercel.app>):
  [`/_nf/health`](https://next-federation-example-vite-remote.vercel.app/_nf/health) answers `ok`.
  Hosts ask `/_nf/*` for islands; each answer names the build it came from (the panel prints
  `remote build <id>`).
- **components-remote** (<https://next-federation-example-components-remote.vercel.app>):
  [`/_nf/components.json`](https://next-federation-example-components-remote.vercel.app/_nf/components.json)
  is the current build's descriptor: its files and their sha384, signed. The two Next.js hosts
  server-render `CartButton` only from a build signed with the key they trust.

## Source and guides

Each app is a folder of [`examples/`](../examples/README.md), small enough to copy:

| App                 | Source                                                      | Guide                                                          |
| ------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `next-app-router`   | [examples/next-app-router](../examples/next-app-router)     | [App Router host](guides/getting-started-app-router.md)        |
| `next-pages-router` | [examples/next-pages-router](../examples/next-pages-router) | [Pages Router host](guides/getting-started-pages-router.md)    |
| `react-spa`         | [examples/react-spa](../examples/react-spa)                 | [SPA host](guides/getting-started-spa.md)                      |
| `vite-remote`       | [examples/vite-remote](../examples/vite-remote)             | [Writing an island remote](guides/writing-an-island-remote.md) |
| `components-remote` | [examples/components-remote](../examples/components-remote) | [Remote components](guides/remote-components.md)               |

To run all five locally, run `pnpm examples:dev` in a checkout of the repository
([examples/README.md](../examples/README.md)). How the demo is deployed:
[Deploying an island remote on Vercel](guides/deploying-a-remote-on-vercel.md) and the
[maintainer note](maintainers/live-demo.md).
