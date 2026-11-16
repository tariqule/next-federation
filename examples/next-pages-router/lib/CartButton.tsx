import * as CartContext from 'example-cart-context'
import { createRemoteComponent } from '@next-federation/react/components'

// Binds the `cart` remote's exposed `./CartButton` (a client component). It
// runs on this host's React, and `shared` hands it this host's
// example-cart-context module, so it reads and updates the host's cart.
export const CartButton = createRemoteComponent<{ sku: string }>({
  expose: './CartButton',
  shared: { 'example-cart-context': { version: '1.0.0', module: CartContext } },
  fallback: <p>cart button unavailable</p>,
})
