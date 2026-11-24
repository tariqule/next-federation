# Commerce platform (advanced examples)

**Trailhead**, a made-up outdoor shop, built the way a larger company would build it: several
apps, owned and deployed separately, that make up the same pages at runtime. It is the advanced
companion to the [first examples](../README.md): many features on the same pages, all running
locally.

The shop is split along the usual e-commerce page domains:

- **CDP (category page)**: the category navigation and the product grid with its filters.
- **PDP (product detail page)**: the product detail with its gallery, recommendations, and
  personal picks.
- **SERP (search results page)**: the search results.

Each of these is an island remote. Next to them, the **Account** remote serves private islands
with Server Actions, the **Header** remote serves React components built with Rspack, and the
platform owns the host, the storefront.

## What is in it

```text
 ┌────────────────────────────────────────────────────────┐
 │ HOST  storefront  (Next.js 16)                  :13410 │
 │  app/    /store/en|fr/…   App Router, cacheComponents  │
 │  pages/  /store/admin     Pages Router                 │
 └───┬───────────┬───────────┬───────────┬───────────┬────┘
     │ on its server: island envelopes, the header descriptor, and one
     │ signed token per remote for private islands
     ▼           ▼           ▼           ▼           ▼
 ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────────┐
 │ CDP     │ │ PDP     │ │ SERP    │ │ Account  │ │ Header           │
 │ :13400  │ │ :13401  │ │ :13402  │ │ :13403   │ │ :13404           │
 │ Vite    │ │ Vite    │ │ Vite    │ │ Vite     │ │ Rspack +         │
 │ islands │ │ islands │ │ islands │ │ islands +│ │ Module Federation│
 │         │ │ + ForYou│ │         │ │ Server   │ │ 2.0 components   │
 │         │ │ private │ │         │ │ Actions  │ │ (signed build)   │
 └─────────┘ └─────────┘ └─────────┘ └──────────┘ └──────────────────┘
```

| App                                                                       | Owned by                   | Role   | Framework and bundler                   | What it shows                                                                                                                       | Port                |
| ------------------------------------------------------------------------- | -------------------------- | ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| [`storefront`](storefront/)                                               | Platform                   | Host   | Next.js 16, App Router and Pages Router | `cacheComponents` static shells, streamed and `blocking` private islands, `revalidateIsland`, `basePath`, two locales, mixed router | 13410 (`localhost`) |
| [`cdp-remote`](cdp-remote/)                                               | CDP (category page)        | Remote | Vite island remote (`cdp`)              | Public islands `CategoryNav`, `ProductGrid` (client filters), refreshed on demand                                                   | 13400 (`127.0.0.1`) |
| [`pdp-remote`](pdp-remote/)                                               | PDP (product detail page)  | Remote | Vite island remote (`pdp`)              | `ProductDetail` (gallery), `Recommendations`, private `ForYou`                                                                      | 13401 (`127.0.0.1`) |
| [`serp-remote`](serp-remote/)                                             | SERP (search results page) | Remote | Vite island remote (`serp`)             | `SearchResults`, cached per query                                                                                                   | 13402 (`127.0.0.1`) |
| [`account-remote`](account-remote/)                                       | Account                    | Remote | Vite island remote (`account`)          | Private islands, Server Actions (`<Form>`, `requireIdentity`, optimistic and pending UI), an admin role check                       | 13403 (`127.0.0.1`) |
| [`header-remote-rspack`](header-remote-rspack/)                           | Header                     | Remote | Rspack + `@module-federation/enhanced`  | Remote components (`Header`, `SearchBox`, `MiniCart`, `AddToCart`) reading two host contexts, signed with `nf-describe`             | 13404 (`127.0.0.1`) |
| [`design-system`](design-system/)                                         | Design system              | Shared | Plain JavaScript package                | A shared module with a version range and a bundled fallback copy                                                                    | (a package)         |
| [`session-context`](session-context/), [`cart-context`](../cart-context/) | Platform                   | Shared | Plain JavaScript packages               | The host-owned React contexts the Header remote reads                                                                               | (packages)          |
| [`catalog-data`](catalog-data/)                                           | CDP, PDP, SERP             | Shared | Plain JavaScript package                | Stands in for the product API the three remotes call                                                                                | (a package)         |
| [`inspect`](inspect/)                                                     | Platform                   | Shared | Demo helper                             | The labels and the **How is this page built?** layer                                                                                | (a package)         |

### Looking for one feature?

| Feature                                                          | Where                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A remote built with Rspack (another bundler) consumed by Next.js | [`header-remote-rspack`](header-remote-rspack/), bound in `storefront/lib/header.app.tsx` |
| Server Actions in islands                                        | [`account-remote`](account-remote/) (`src/actions.ts`)                                    |
| `cacheComponents`, `blocking`, `revalidateIsland`                | [`storefront`](storefront/) (`app/[lang]/account/page.tsx`, `app/api/publish/route.ts`)   |
| App Router and Pages Router in one app                           | [`storefront`](storefront/) (`pages/admin.tsx` next to `app/`)                            |

### Static and dynamic, on one page

```text
/store/en/p/A1                     configured as ◐ partial prerender
┌─ static shell: prerendered once, cached until its tags are revalidated ───┐
│ header   Header · SearchBox · MiniCart   Header remote, server-rendered   │
│          AccountBadge  (Account, private)  ░░ streamed per request ░░     │
│ main     ProductDetail     PDP, revalidate 3600 s, tags nf:pdp…          │
│          AddToCart         Header remote, server-rendered                │
│          Recommendations   PDP                                           │
│          ForYou  (PDP, private)  ░░░░░░░░░ streamed per request ░░░░░░░ │
└───────────────────────────────────────────────────────────────────────────┘
/store/en/search?q=…   ◐  static shell; SearchResults streamed (cached per query)
/store/en/account      ƒ  instant = false; Profile and Orders are blocking:
                          in the first HTML, in place, per request
/store/admin           ƒ  Pages Router, getServerSideProps: everything per request
```

## Run it

From the repository root, after `pnpm install` and `pnpm build`:

```sh
pnpm examples:platform
```

This writes the demo keys if they are missing (`pnpm examples:keys`), builds every app, starts
them in order (remotes first: the storefront's build prerenders pages from them) and prints the
URLs. It runs production builds, because static shells, React sharing and build retention only
exist there. Ports 13400-13404 and 13410 must be free; Ctrl-C stops everything.

`pnpm examples:platform:dev` runs the remotes' and hosts' dev servers instead (no static shells
and no React sharing; the Header remote is always a build). `pnpm examples:platform:smoke` builds,
starts and checks everything over HTTP, then stops (CI runs it). App logs go to `examples/.logs/`.

## Walkthrough

1. **Open <http://localhost:13410/store/en>.** The header (navigation, search box, mini cart) comes
   from the Header remote, an Rspack build. The storefront rendered it on its own server, because
   the build's descriptor is signed with a key it trusts. The category links and the product grid
   are islands from the CDP remote: rendered on the CDP remote's server, prerendered into this
   page's static shell. Turn JavaScript off: they are still there.
   Guides: [Remote components](../../docs/guides/remote-components.md),
   [Caching](../../docs/guides/caching.md).
2. **Turn on _How is this page built?_** (bottom right). Every piece gets a chip that says what it
   is, which remote serves it, where it rendered and whether it came in the first HTML or streamed
   in later. Click a chip for the details: the cache mode the code configured, revalidate time and
   tags, router, identity and build id. The panel at the top describes the whole route. Turn it on
   on every page below.
3. **Filter the grid, then click a product.** The filter buttons are the island's own client
   component, on the island's own React. The product link is an island `Link`: it navigates the
   storefront's router without a reload. On the product page, the detail and recommendations come
   from the PDP remote. Guide: [Writing an island remote](../../docs/guides/writing-an-island-remote.md).
4. **Click _Add to cart_.** It is a Header remote component, and so is the mini cart. Both read the
   storefront's cart context (a shared module the host provides), so the count updates at once.
   Turned on, the chips also show the design system's `Button` and `Pill`: here they are the host's
   copy. Guide: [Sharing modules](../../docs/guides/remote-components.md#sharing-modules).
5. **Search for "camp" in the header.** The search box (Header remote) navigates with the host's
   router to `/store/en/search?q=camp`, where the SERP remote's results stream into the static
   shell. Each query's envelope is cached.
6. **Sign in on _Account_ as a customer** (any name; a demo form, no password). The header's
   `AccountBadge` (Account remote) now streams in per request. **Profile** and **Orders** are
   `blocking` private islands: view the page source and they are there, in place, with no loading
   state, and no token. Guides: [Identity](../../docs/guides/identity.md),
   [blocking](../../docs/guides/getting-started-app-router.mdx#put-private-content-in-the-first-html).
7. **Change your display name, then cancel an order.** These are Server Actions of the Account
   remote, posted from the browser straight to that remote with the island's own token. The name
   shows at once (optimistic) while the button says _Saving…_; the order shows _cancelling…_ until
   the remote answers. A small message at the bottom left reports each action (the islands'
   `nf:island` events). Guide: [Server Actions in islands](../../docs/guides/server-actions.md).
8. **Open a product again.** _Picked for you_ is a private island from the PDP remote. The same
   sign-in gives each remote its own token, minted for that remote's audience only.
9. **Open _Admin_.** It is a Pages Router route of the same Next.js app (the link reloads the page:
   that is how links between Next's two routers work). It has the same header components and the
   same `ProductGrid` island, now rendered by the Pages Router, per request. As a customer, the
   **Inventory** island refuses you: the Account remote checks the `role` claim in the signed token.
   Sign in again as an admin (Account page) and it shows the stock, with a _+10_ action. Guide:
   [Mixed-router hosts](../../docs/guides/remote-components.md#mixed-router-hosts).
10. **Publish.** As an admin, press _Publish_ on the admin page. It calls `revalidateIsland('cdp')`
    and `revalidateIsland('pdp')`; open the home page and the grid's "rendered by the CDP remote
    at" time changes. In production, the remotes' deploy pipeline would call such a route.
    Guide: [Refreshing on demand](../../docs/guides/caching.md#refreshing-on-demand).
    Coming later: an outage switch (stale-if-error and `errorFallback`), a redeploy while a tab stays
    open (build retention), and a React Router SPA host that shares its React with the islands.

## Security notes

- **No tokens in the page.** Private islands get a short-lived token signed for one remote's
  audience. The storefront mints it on its server and sends it to that remote only; the HTML, the
  RSC payload and the Pages Router props never contain it (the smoke test checks). In the browser,
  islands fetch tokens from the storefront's own token route, kept in memory only.
- **Signed remote code.** The storefront evaluates the Header remote's server code only for a
  build whose descriptor is signed with the key it trusts (`NF_COMPONENTS_PUBLIC_KEY`), and every
  file must match its sha384. Any other build renders in the browser only.
- **CORS allowlist.** Each island remote lists the browser origins that may embed it (`hosts` in
  its `vite.config.ts`).
- **Roles are claims, checked by the remote.** The admin island and its action check the `role`
  claim the storefront signed. The Account remote trusts it because it accepts one issuer only.
- **Demo sign-in.** The session is two plain cookies set by a form, with no password. Replace it
  with your authentication; next-federation only needs `getIdentity`.

## How this maps to your company

- **One remote per domain, one deploy each.** The CDP, PDP, SERP and Account remotes each ship on
  their own schedule. A deploy changes what the hosts render without rebuilding the hosts: the
  storefront picks up a new build when its cache entries expire, or at once when the remote's
  pipeline calls a revalidate route.
- **The platform owns the hosts, the session and the contexts.** Remotes never read host cookies or
  host state. They get props (islands), signed claims (private islands) or shared modules the host
  chooses to pass (remote components).
- **Pick the mechanism per piece.** A piece that owns its data and may run anywhere is an island
  (CDP, PDP, SERP, Account). A small interactive piece that must share the page's state is a remote
  component (Header), and the host decides whether to trust its server code.
- **Old builds stay online.** Remotes keep several builds (`nf-serve` retention), so pages cached
  or open during a deploy keep working. Keep the retention longer than your longest host cache.

## What is not supported

These examples stay inside what next-federation supports. Hosts are Next.js (App Router or Pages
Router) or a client-side React app. Remotes are Vite island remotes, or Module Federation 2.0
component remotes built with Vite or Rspack (webpack is documented but untested).

- Vue, Svelte, Angular or any other non-React framework, as a host or a remote.
- A Next.js app as a remote: share its UI as an island remote or a components remote instead
  ([Sharing components from a Next.js app](../../docs/guides/sharing-components-from-a-next-app.md)).
- React Router in framework mode (server rendering) as a host: planned after 1.0.
- Private islands in a client-only SPA: they need a server to sign tokens.

See [Limits](../../docs/guides/limits.md).

## Not shown here

- Islands on a different exact React version on the same page (each build would keep its own copy;
  the e2e suite tests it with `test/fixtures/island-remote-old-react`).
- Deploying the platform: each remote deploys like the first examples
  ([Deploying an island remote on Vercel](../../docs/guides/deploying-a-remote-on-vercel.md)).
