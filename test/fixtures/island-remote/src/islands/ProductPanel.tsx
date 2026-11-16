import './ProductPanel.css'
import { getProduct } from '../data'
import { Counter, RscMarker } from './Counter'

export default async function ProductPanel({ sku }: { sku: string }) {
  const product = await getProduct(sku)
  return (
    <section className="nf-product-panel" data-island="ProductPanel">
      <h2>{product.name}</h2>
      <p>${product.price}</p>
      <Counter />
      <RscMarker value={`nf-rsc-marker-${sku}`} />
    </section>
  )
}
