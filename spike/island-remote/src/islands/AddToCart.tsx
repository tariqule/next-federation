'use client'

export function AddToCart({ sku }: { sku: string }) {
  return (
    <span>
      <button data-testid="add-to-cart">Add {sku}</button> <output data-testid="cart-count">0</output>
    </span>
  )
}
