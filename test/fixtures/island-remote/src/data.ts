import 'server-only'

// Server-only fake data. Never reaches the browser.
const products: Record<string, { name: string; price: number }> = {
  A1: { name: 'Product A1', price: 42 },
  B2: { name: 'Product B2', price: 7 },
}

export async function getProduct(sku: string) {
  await new Promise((r) => setTimeout(r, 5))
  return products[sku] ?? { name: `Product ${sku}`, price: 0 }
}

export async function getOrders(sub: string) {
  return [{ id: 'o1', title: `Order 1 of ${sub}` }]
}
