'use client'
import { useCart } from 'example-cart-context'

export function CartCount() {
  const { items } = useCart()
  return <span className="cart-count">Cart: {items.length} item(s)</span>
}
