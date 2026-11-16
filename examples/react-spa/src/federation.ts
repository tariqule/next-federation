import { defineFederation, fetchIsland } from '@next-federation/core'

// Two remotes: `shop` serves islands, `cart` serves client components.
// Both list this app's origin (http://localhost:3303) as an allowed host.
export const federation = defineFederation({
  remotes: {
    shop: { origin: 'http://127.0.0.1:3300' },
    cart: { origin: 'http://127.0.0.1:3304' },
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
