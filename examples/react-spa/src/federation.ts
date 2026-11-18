import { defineFederation, fetchIsland } from '@next-federation/core'

// The remotes' URLs, fixed at build time: VITE_SHOP_ORIGIN and
// VITE_CART_ORIGIN in a deployment, else the local ports.
export const SHOP_ORIGIN =
  import.meta.env.VITE_SHOP_ORIGIN || 'http://127.0.0.1:3300'
export const CART_ORIGIN =
  import.meta.env.VITE_CART_ORIGIN || 'http://127.0.0.1:3304'

// Two remotes: `shop` serves islands, `cart` serves client components. The
// island remote lists this app's origin in its `hosts` (CORS).
export const federation = defineFederation({
  remotes: {
    shop: { origin: SHOP_ORIGIN },
    cart: { origin: CART_ORIGIN },
  },
})

/** Fetches an island envelope from the browser (CORS). */
export function loadIsland(island: string, props?: unknown) {
  return fetchIsland(federation.target('shop'), {
    island,
    props,
    init: { cache: 'no-store' },
  })
}
