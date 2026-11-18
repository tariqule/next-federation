import 'server-only'
import { defineFederation } from '@next-federation/core'
import { createFederationRoutes } from '@next-federation/next/routes'
import { createIslands } from '@next-federation/next/server'
import type { AppIdentity } from '@next-federation/next/server'

// Keys come from .env.local, written by `pnpm examples:keys` (in a
// deployment: environment variables).
//   NF_SIGNING_KEY            private JWK: signs identity tokens for remotes
//   NF_COMPONENTS_PUBLIC_KEY  public JWK of the components remote's builds
const componentsKey = process.env.NF_COMPONENTS_PUBLIC_KEY
// The remotes' URLs and this host's own (the identity issuer): fixed by
// configuration, never taken from a request. Defaults: the local ports.
const SHOP_ORIGIN = process.env.SHOP_ORIGIN || 'http://127.0.0.1:3300'
const CART_ORIGIN = process.env.CART_ORIGIN || 'http://127.0.0.1:3304'
const APP_ROUTER_ORIGIN =
  process.env.APP_ROUTER_ORIGIN || 'http://localhost:3301'

export const federation = defineFederation({
  remotes: {
    // Islands (server components rendered by the remote).
    shop: { origin: SHOP_ORIGIN },
    // Remote components (client components). Server-rendered here only for builds signed
    // with the key below; without a key they render in the browser only.
    cart: {
      origin: CART_ORIGIN,
      components: {
        name: 'cart', // the remote's container name; anything else is refused
        ssr: { publicKeys: componentsKey ? [JSON.parse(componentsKey)] : [] },
      },
    },
  },
  identity: {
    issuer: APP_ROUTER_ORIGIN,
    signingKeys: process.env.NF_SIGNING_KEY!,
  },
})

// DEMO ONLY: the user is whatever name the sign-in form posted, kept in a
// plain cookie. Read your real session here instead.
const getIdentity: AppIdentity = ({ cookies }) => {
  const user = cookies.get('demo-user')?.value
  return user ? { sub: user } : null
}

export const { RemoteIsland } = createIslands(federation, { getIdentity })
export const routes = createFederationRoutes(federation, { getIdentity })
