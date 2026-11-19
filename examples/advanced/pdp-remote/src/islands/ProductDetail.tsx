import './pdp.css'
import { formatPrice, getProduct, productName } from 'example-catalog-data'
import { Gallery } from './Gallery'

const LABELS = {
  en: { missing: 'No such product', tags: 'Tags' },
  fr: { missing: 'Produit introuvable', tags: 'Étiquettes' },
}

// A public island rendered on the PDP remote's server. The host prerenders
// it into each product page's static shell.
export default async function ProductDetail({
  sku,
  locale = 'en',
}: {
  sku: string
  locale?: string
}) {
  const t = locale === 'fr' ? LABELS.fr : LABELS.en
  const product = getProduct(sku)
  if (!product) return <p>{t.missing}</p>
  return (
    <section className="pdp-detail">
      {/* A client component: hydrated on the island's own React. */}
      <Gallery sku={product.sku} />
      <div>
        <h2>{productName(product, locale)}</h2>
        <p className="pdp-price">{formatPrice(product.price, locale)}</p>
        <p>
          {t.tags}: {product.tags.join(', ')}
        </p>
        <small className="pdp-build">remote build {__BUILD_ID__}</small>
      </div>
    </section>
  )
}
