// The federation, shared by both routers. No Next.js imports, so tools such
// as nf-types can load it too. Server-side only (it holds the signing key).
import { defineFederation } from '@next-federation/core'

// Keys come from .env.local, written by `pnpm examples:keys` (in a
// deployment: environment variables, the private key in a secret store).
//   NF_SIGNING_KEY            private JWK: signs identity tokens for remotes
//   NF_COMPONENTS_PUBLIC_KEY  public JWK of the header remote's builds
// URLs are configuration, never taken from a request. Locally they default
// to the example ports (remotes on 127.0.0.1, this host on localhost).
const env = (name: string, local: string) => process.env[name] || local
const headerKey = process.env.NF_COMPONENTS_PUBLIC_KEY

export const STOREFRONT_ORIGIN = env(
  'STOREFRONT_ORIGIN',
  'http://localhost:13410'
)

export const federation = defineFederation({
  remotes: {
    // Island remotes: they render Server Components on their own servers.
    cdp: { origin: env('CDP_ORIGIN', 'http://127.0.0.1:13400') },
    pdp: { origin: env('PDP_ORIGIN', 'http://127.0.0.1:13401') },
    serp: { origin: env('SERP_ORIGIN', 'http://127.0.0.1:13402') },
    account: { origin: env('ACCOUNT_ORIGIN', 'http://127.0.0.1:13403') },
    // A remote components remote built with Rspack: server-rendered here
    // only for builds signed with this key; any other build renders in the
    // browser only.
    header: {
      origin: env('HEADER_ORIGIN', 'http://127.0.0.1:13404'),
      components: {
        name: 'header', // the remote's container name; anything else is refused
        ssr: { publicKeys: headerKey ? [JSON.parse(headerKey)] : [] },
      },
    },
  },
  // Public islands are cached for an hour unless a page says otherwise; the
  // admin's "Publish" button refreshes them at once (revalidateIsland).
  islands: { revalidate: 3600 },
  // basePath /store is part of the issuer (and of the JWKS URL remotes use).
  identity: {
    issuer: `${STOREFRONT_ORIGIN}/store`,
    signingKeys: process.env.NF_SIGNING_KEY!,
  },
})

export const LOCALES = ['en', 'fr'] as const
export type Locale = (typeof LOCALES)[number]
export const CATEGORY_SLUGS = ['shoes', 'outdoor']
export const SKUS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']
