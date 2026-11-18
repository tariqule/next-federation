import * as CartContext from 'example-cart-context'
import {
  createRemoteComponent,
  fetchDescriptorInBrowser,
} from '@next-federation/react/components'
import { Suspense, use } from 'react'
import { CART_ORIGIN } from './federation'

const RemoteCartButton = createRemoteComponent<{ sku: string }>({
  expose: './CartButton',
  shared: { 'example-cart-context': { version: '1.0.0', module: CartContext } },
  fallback: <p>loading the cart button…</p>,
  errorFallback: <p>cart button unavailable</p>,
})

// A client component from the `cart` remote, rendered in the browser only
// (an SPA never runs remote server code). Fetched once per page load.
const descriptor = fetchDescriptorInBrowser(
  `${CART_ORIGIN}/_nf/components.json`,
  { remote: 'cart' }
)

function Loaded({ sku }: { sku: string }) {
  return <RemoteCartButton descriptor={use(descriptor)} sku={sku} />
}

export function CartButton({ sku }: { sku: string }) {
  return (
    <Suspense fallback={<p>loading…</p>}>
      <Loaded sku={sku} />
    </Suspense>
  )
}
