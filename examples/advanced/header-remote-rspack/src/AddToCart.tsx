import { useCart } from 'example-cart-context'
import { Button } from 'example-design-system'

/**
 * Adds a product to the host's cart. The cart is host state (the host's
 * CartProvider), so the header's mini cart updates at once.
 */
export default function AddToCart({
  sku,
  label,
}: {
  sku: string
  label: string
}) {
  const { items, add } = useCart()
  const count = items.filter((s) => s === sku).length
  return (
    <Button onClick={() => add(sku)}>
      {label}
      {count > 0 ? ` (${count} in cart)` : ''}
    </Button>
  )
}
