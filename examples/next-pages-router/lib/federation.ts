// Server-side only: import this file from getServerSideProps, getStaticProps
// and API routes, which Next removes from the browser bundle.
import { defineFederation } from '@next-federation/core'
import { createPagesIslands } from '@next-federation/next/pages/server'
import type { PagesIdentity } from '@next-federation/next/pages/server'

// Keys come from .env.local, written by `pnpm examples:keys`.
//   NF_SIGNING_KEY            private JWK: signs identity tokens for remotes
//   NF_COMPONENTS_PUBLIC_KEY  public JWK of the components remote's builds
const componentsKey = process.env.NF_COMPONENTS_PUBLIC_KEY

export const federation = defineFederation({
  remotes: {
    shop: { origin: 'http://127.0.0.1:3300' },
    cart: {
      origin: 'http://127.0.0.1:3304',
      components: {
        name: 'cart', // the remote's container name; anything else is refused
        ssr: { publicKeys: componentsKey ? [JSON.parse(componentsKey)] : [] },
      },
    },
  },
  // With a basePath the issuer includes it (and so does the JWKS URL the
  // remote lists: http://localhost:3302/shop/api/next-federation/jwks).
  identity: {
    issuer: 'http://localhost:3302/shop',
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
