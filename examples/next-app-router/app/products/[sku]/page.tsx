import { ProductPage } from '../../../lib/ProductPage'

export default async function Product({
  params,
}: {
  params: Promise<{ sku: string }>
}) {
  const { sku } = await params
  return <ProductPage sku={sku} />
}
