// Server-side only: import this file from getServerSideProps, getStaticProps
// and API routes, which Next removes from the browser bundle.
import { defineFederation } from '@next-federation/core'
import { createPagesIslands } from '@next-federation/next/pages/server'
import type { PagesIdentity } from '@next-federation/next/pages/server'

// Keys come from .env.local, written by `pnpm examples:keys` (in a
// deployment: environment variables).
//   NF_SIGNING_KEY            private JWK: signs identity tokens for remotes
//   NF_COMPONENTS_PUBLIC_KEY  public JWK of the components remote's builds
const componentsKey = process.env.NF_COMPONENTS_PUBLIC_KEY
// The remotes' URLs and this host's own (the identity issuer): fixed by
// configuration, never taken from a request. Defaults: the local ports.
const SHOP_ORIGIN = process.env.SHOP_ORIGIN || 'http://127.0.0.1:3300'
const CART_ORIGIN = process.env.CART_ORIGIN || 'http://127.0.0.1:3304'
const PAGES_ROUTER_ORIGIN =
  process.env.PAGES_ROUTER_ORIGIN || 'http://localhost:3302'

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
    signingKeys: process.env.NF_SIGNING_KEY!,
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
