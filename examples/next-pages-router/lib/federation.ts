// Server-side only: import this file from getServerSideProps, getStaticProps
// and API routes, which Next removes from the browser bundle.
import { defineFederation } from '@next-federation/core'
import { createPagesIslands } from '@next-federation/next/pages/server'
import type { PagesIdentity } from '@next-federation/next/pages/server'

// Keys come from .env.local, written by `pnpm examples:keys` (in a
// deployment: environment variables).
//   NF_SIGNING_KEY            private JWK: signs identity tokens for remotes
//   NF_COMPONENTS_PUBLIC_KEY  public JWK of the components remote's builds
// The remotes' URLs and this host's own (the identity issuer) are fixed by
// configuration, never taken from a request. Locally they default to the
// example ports. On Vercel every variable is required: a missing one fails
// the build instead of falling back to localhost.
function env(name: string): string | undefined {
  const value = process.env[name]
  if (!value && process.env.VERCEL) {
    throw new Error(`${name} is not set: set it on the Vercel project`)
  }
  return value || undefined
}
const componentsKey = env('NF_COMPONENTS_PUBLIC_KEY')
const SHOP_ORIGIN = env('SHOP_ORIGIN') ?? 'http://127.0.0.1:3300'
const CART_ORIGIN = env('CART_ORIGIN') ?? 'http://127.0.0.1:3304'
const PAGES_ROUTER_ORIGIN =
  env('PAGES_ROUTER_ORIGIN') ?? 'http://localhost:3302'

export const federation = defineFederation({
  remotes: {
    shop: { origin: SHOP_ORIGIN },
    cart: {
      origin: CART_ORIGIN,
      components: {
        name: 'cart', // the remote's container name; anything else is refused
        ssr: { publicKeys: componentsKey ? [JSON.parse(componentsKey)] : [] },
      },
    },
  },
  // With a basePath the issuer includes it (and so does the JWKS URL the
  // remote lists: <origin>/shop/api/next-federation/jwks).
  identity: {
    issuer: `${PAGES_ROUTER_ORIGIN}/shop`,
    signingKeys: env('NF_SIGNING_KEY')!,
  },
})

// DEMO ONLY: the user is whatever name the sign-in form posted, kept in a
// plain cookie. Read your real session here instead.
export const getIdentity: PagesIdentity = (req) => {
  const user = req.cookies['demo-user']
  return user ? { sub: user } : null
}

export const { getIslandProps } = createPagesIslands(federation, {
  getIdentity,
})
