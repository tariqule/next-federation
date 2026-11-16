import 'server-only'

// Stands in for your database or API: runs on the remote's server only.
export type Product = { sku: string; name: string; price: number }

const products: Product[] = [
  { sku: 'A1', name: 'Trail shoe', price: 89 },
  { sku: 'B2', name: 'Rain jacket', price: 129 },
  { sku: 'C3', name: 'Camp mug', price: 14 },
]

export async function getProducts(): Promise<Product[]> {
  return products
}

export async function getProduct(sku: string): Promise<Product | undefined> {
  return products.find((p) => p.sku === sku)
}

export async function getOrders(user: string) {
  return [
    { id: '1001', title: `Trail shoe, size 42 (for ${user})` },
    { id: '1002', title: 'Camp mug' },
  ]
}
