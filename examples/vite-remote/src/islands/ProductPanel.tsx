import './shop.css'
import { getProduct } from '../data'
import { Quantity } from './Quantity'

const LABELS = {
  en: { price: 'Price', missing: 'No such product' },
  fr: { price: 'Prix', missing: 'Produit introuvable' },
}

// A public island: a Server Component rendered on the remote. Props are
// plain JSON; the host passes its locale because React context does not
// cross into an island.
export default async function ProductPanel({
  sku,
  locale = 'en',
}: {
  sku: string
  locale?: string
}) {
  const t = locale === 'fr' ? LABELS.fr : LABELS.en
  const product = await getProduct(sku)
  if (!product) return <p className="shop-panel">{t.missing}</p>
  const price = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
  }).format(product.price)
  return (
    <section className="shop-panel">
      <h2>{product.name}</h2>
      <p>
        {t.price}: {price}
      </p>
      {/* A client component: hydrated in the browser, on the island's React. */}
      <Quantity />
      <small className="shop-build">remote build {__BUILD_ID__}</small>
    </section>
  )
}
