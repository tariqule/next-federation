import { useCart } from 'example-cart-context'

// A client component hosts load at runtime (Mode A). It runs on the host's
// React and reads the host's cart through the shared context module.
export default function CartButton({ sku }: { sku: string }) {
  const cart = useCart()
  const inCart = cart.items.filter((item) => item === sku).length
  return (
    <p>
      <button onClick={() => cart.add(sku)}>Add {sku} to cart</button>{' '}
      <span>{inCart} in your cart</span>
    </p>
  )
}
