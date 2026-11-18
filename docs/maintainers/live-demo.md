# Live demo on Vercel

Maintainer note. Read it when you set up, change or rotate the keys of the live demo: the five apps
in `examples/`, deployed to Vercel from `main` and linked from the README, the docs site home and
[examples/README.md](../../examples/README.md#live-demo).

The other projects' environment variables name each project's URL, so each project's domain must
be fixed before the first deploy.

## Projects

Five projects on the Hobby team, each connected to `github.com/tariqule/next-federation`, Production
Branch `main`. The install, build and ignore commands live in each folder's `vercel.json`; leave the
dashboard's Build and Output Settings on their defaults so they apply. Each project's production
domain is `<project>.vercel.app`:

| Project                                     | Root Directory               | Framework (`vercel.json`) | Output                             |
| ------------------------------------------- | ---------------------------- | ------------------------- | ---------------------------------- |
| `next-federation-example-vite-remote`       | `examples/vite-remote`       | Other (`null`)            | `dist/vercel/static` + `api/nf.ts` |
| `next-federation-example-components-remote` | `examples/components-remote` | Other (`null`)            | `dist/vercel/static`               |
| `next-federation-example-app-router`        | `examples/next-app-router`   | Next.js                   | Next.js                            |
| `next-federation-example-pages-router`      | `examples/next-pages-router` | Next.js                   | Next.js                            |
| `next-federation-example-react-spa`         | `examples/react-spa`         | Vite                      | `dist`                             |

**Claim the full domain.** Vercel shortens a long project name when it generates the default
domain: it gave `next-federation-example-components.vercel.app` and
`next-federation-example-pages-route.vercel.app` to two of these projects. For those, add the full
`<project>.vercel.app` under **Settings → Domains**, make it the production domain and let the
shortened one redirect to it (308). A remote with two domains must also name the one it serves
from: set its `NF_PUBLIC_ORIGIN` (below). `VERCEL_PROJECT_PRODUCTION_URL` holds the shortest
production domain, here the shortened one, and a remote whose `base` redirects breaks every host.

Every project:

- **Install command**: `pnpm install --frozen-lockfile --filter <package>...` (the docs site uses
  the same pattern). pnpm runs it at the workspace root and installs the example, the workspace
  packages it depends on, and the root's dev dependencies (`tsdown`, which builds the packages).
- **Build command**: `pnpm --filter "<package>^..." build && …`. The examples use the
  `@next-federation/*` packages from source (`workspace:*`), so their dependencies are built first,
  in dependency order. Then the remotes run `node scripts/vercel-build.ts` and the hosts
  `pnpm run build` (`next build` or `vite build`).
- **Ignore command** (`ignoreCommand`): `[ "$VERCEL_ENV" = "production" ] && exit 1 || exit 0`.
  Vercel runs it in the Root Directory before building: exit `1` builds, exit `0` cancels the
  deployment. So only production deployments (pushes to `main`, or a production redeploy) build;
  every preview deployment is canceled. Previews are off because the private keys are set for
  Production only, and the island remote lists only the hosts' production origins, so a preview
  host could not embed it anyway. A canceled preview still counts towards the deployment quota. The
  command reads Vercel's system variables, which projects expose by default (**Automatically
  expose System Environment Variables**). It does not also skip a production build when nothing
  changed (`git diff --quiet HEAD^ HEAD -- …`). Vercel clones 10 commits deep, so `HEAD^` exists,
  but that diff sees only the last commit of a push, misses root files the build reads
  (`package.json`, `tsconfig.base.json`), and a redeploy of the same commit after a key rotation
  would be skipped. Vercel's own **Skip deployment** for unaffected monorepo projects (Root
  Directory settings) already skips pushes that change nothing in the workspace graph.
- **Settings to check**: Node.js Version **24.x** (the build scripts are TypeScript run by Node, and
  the workspace needs Node 24); **Include files outside the Root Directory in the Build Step** on
  (the default: the workspace root and `packages/` are outside it); Deployment Protection
  **Standard** (the default). Never "All Deployments": hosts and browsers must reach the remotes'
  production domains without a login.

## Environment variables

Set them for **Production** only: previews are not built (see the ignore command). Mark the private
keys **Sensitive**. `pnpm examples:demo-keys` prints all of them, with new keys and the URLs above
(override a URL with the variable of the same name, or change the prefix with `--prefix <prefix>`);
it writes nothing to disk. Paste each value without quotes.

On Vercel (`VERCEL=1`, at build and run time) every variable in the table is required: a missing one
fails the build with `<NAME> is not set: set it on the Vercel project`, instead of falling back to
the local `localhost` and `127.0.0.1` defaults. The SPA checks its two `VITE_*` variables in
`vite.config.ts`, since they are compiled into the bundle. Locally, the defaults still apply.

| Variable                    | vite-remote | components-remote | app-router  | pages-router | react-spa | Value                                                              |
| --------------------------- | :---------: | :---------------: | :---------: | :----------: | :-------: | ------------------------------------------------------------------ |
| `NF_PUBLIC_ORIGIN`          |      ✓      |         ✓         |             |              |           | the remote's own URL: https, no trailing slash                     |
| `APP_ROUTER_ORIGIN`         |      ✓      |                   |      ✓      |              |           | App Router host URL (no trailing slash)                            |
| `PAGES_ROUTER_ORIGIN`       |      ✓      |                   |             |      ✓       |           | Pages Router host URL, without `/shop`                             |
| `SPA_ORIGIN`                |      ✓      |                   |             |              |           | SPA URL                                                            |
| `SHOP_ORIGIN`               |             |                   |      ✓      |      ✓       |           | island remote URL                                                  |
| `CART_ORIGIN`               |             |                   |      ✓      |      ✓       |           | components remote URL                                              |
| `VITE_SHOP_ORIGIN`          |             |                   |             |              |     ✓     | island remote URL (build time)                                     |
| `VITE_CART_ORIGIN`          |             |                   |             |              |     ✓     | components remote URL (build time)                                 |
| `NF_COMPONENTS_SIGNING_KEY` |             |    ✓ (private)    |             |              |           | private EC P-256 JWK; signs each build's descriptor                |
| `NF_COMPONENTS_PUBLIC_KEY`  |             |                   |      ✓      |      ✓       |           | its public half; hosts server-render only builds it signed         |
| `NF_SIGNING_KEY`            |             |                   | ✓ (private) | ✓ (private)  |           | the host's private ES256 JWK (one per host); signs identity tokens |

What each project does with them:

- **vite-remote**: `hosts` (CORS) is the three host origins; `issuers` maps
  `APP_ROUTER_ORIGIN` and `PAGES_ROUTER_ORIGIN/shop` to their JWKS URLs
  (`…/api/next-federation/jwks`, `…/shop/api/next-federation/jwks`). It holds no secret: it fetches
  each host's public keys at run time. Its `base` is `NF_PUBLIC_ORIGIN`, which the build checks is an
  https origin without a path or trailing slash; without it, `https://` +
  `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets. Never `VERCEL_URL`.
- **components-remote**: `base` as for the island remote. `scripts/vercel-build.ts` fails without
  `NF_COMPONENTS_SIGNING_KEY` and checks that the descriptor is signed.
- **app-router**, **pages-router**: the remotes' origins, the identity issuer (`APP_ROUTER_ORIGIN`;
  `PAGES_ROUTER_ORIGIN` + `/shop`), which must equal what the island remote lists, and the keys. The
  JWKS route serves the public half of `NF_SIGNING_KEY`.
- **react-spa**: the two remote URLs, compiled into the bundle. It signs nothing and server-renders
  nothing, so it has no key.

No other variable is needed. The banner ("Live demo of next-federation · source on GitHub") shows
when Vercel's `NEXT_PUBLIC_VERCEL_ENV` / `VITE_VERCEL_ENV` is set at build time, so never locally.

## Deploy order

1. Create the five projects (names first), claim each full `<project>.vercel.app` domain, and set
   the settings and variables above.
2. Deploy **vite-remote** and **components-remote**. Check
   `https://<vite-remote>/_nf/health` (`ok`) and `https://<components-remote>/_nf/components.json`
   (JSON with a `jws` field).
3. Deploy the three hosts. The App Router build prerenders `/` and `/products/{A1,B2,C3}` from the
   remotes, so the remotes must answer first; a page prerendered without them shows the fallbacks
   until it revalidates (60 s).
4. Check: `/` on the App Router host shows the product panel and **Add A1 to cart** with JavaScript
   off; `/orders` signs in and shows "Orders for <name>"; `/shop/fr` on the Pages Router host shows
   "Produit A1" and links to `/shop/fr/products/…`; the SPA shows the panel and the cart button.

After that, every push to `main` redeploys all five. Order no longer matters much: a host keeps
cached envelopes and descriptors for 60 s, and an island of the previous remote build goes inert
until then ([Deploying an island remote on Vercel](../guides/deploying-a-remote-on-vercel.md#skew-choose-one)).

## Rotating keys

Run `pnpm examples:demo-keys` and replace the keys:

- **Identity** (`NF_SIGNING_KEY`): set the new key on a host and redeploy it. The remote fetches the
  new JWKS; tokens are short-lived.
- **Components** (`NF_COMPONENTS_SIGNING_KEY` and `NF_COMPONENTS_PUBLIC_KEY`): set both, redeploy the
  components remote, then the two Next.js hosts. In between, hosts render the cart button in the
  browser only (`NF-028`), which the demo survives.

## Why it is safe to run publicly

- No secret reaches a browser or the repository: private keys exist only as Sensitive variables of
  the project that uses them. The JWKS route serves public keys only.
- The sign-in is a demo: any name (letters, digits, `_`, `-`, at most 32), kept in a plain
  `HttpOnly`, `SameSite=Lax` cookie, `Secure` on Vercel and over https, with no password and nothing
  stored. The orders are made-up data.
- Redirects go to fixed paths (`/orders`, `/shop/orders`, `/` → `/shop`); none takes a URL from the
  request.
- Remote origins come from the variables above, never from a request, so a host fetches only its two
  remotes (no SSRF). The island remote answers CORS for the three hosts only, and private islands
  only with a token one of the two hosts signed.
- No Server Actions: nothing writes state. Each Vercel deployment keeps nothing between requests.
- The App Router host prerenders the three products and answers `404` for any other
  `/products/<sku>` (`dynamicParams = false`), so requests cannot fill its cache. The Pages Router
  pages render per request and cache nothing; they also answer `404` for any SKU but `A1`, `B2` and
  `C3` (`lib/product-props.ts`), so a request names only those to the island remote.

Heavy traffic can still use up the Hobby plan's function invocations. If that happens, turn on
the Vercel Firewall's challenge mode (`Attack Challenge Mode` in the dashboard) for that project.

## What was checked before the first deploy

Locally, with `VERCEL=1` and `VERCEL_PROJECT_PRODUCTION_URL` set, in a clean copy of the repository:
each project's install and build command from its `vercel.json`; the island remote's Function
wrapper (health, CORS for a listed and an unlisted origin, `410 NF-023` for another build's path,
`401` for a private island without a token); the components build is signed and verifies with
`nf-describe --verify`. Then both remote outputs, served over https with their `vercel.json`
rewrites and headers, embedded by the three hosts built and started with the variables above: server
HTML, sign-in and the private island, the Pages Router `basePath` and locale, and, in Chromium, the
cart button and the island's client component on all three hosts.

The hardening round (public origin, ignore command, `Secure` cookie, required variables, bounded
Pages Router products) was checked the same way: each build command in a clean copy with
`VERCEL=1` and every variable, then with one variable missing (the build fails and names it), the
ignore command under `sh`, `dash`, `bash` and `zsh` (exit `1` for `production`, `0` otherwise), and
`pnpm examples:smoke`.

Not checked locally (only on Vercel): Vercel's own install (pnpm version, Node version), its file
tracing of `api/nf.ts` from a Git build (the guide tested `vercel build` with a prebuilt deploy), the
framework variables that turn the banner on, and the `/` → `/shop` redirect on Vercel's router.
