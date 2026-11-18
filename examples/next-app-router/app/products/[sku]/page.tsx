import { ProductPage } from '../../../lib/ProductPage'

// The remote's products, prerendered. Any other path is a 404, so a public
// deployment caches (and asks the remote for) these pages only.
export const dynamicParams = false
export function generateStaticParams() {
  return ['A1', 'B2', 'C3'].map((sku) => ({ sku }))
}

export default async function Product({
  params,
}: {
  params: Promise<{ sku: string }>
}) {
  const { sku } = await params
  return <ProductPage sku={sku} />
}
