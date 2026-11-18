import './serp.css'
import { formatPrice, productName, search } from 'example-catalog-data'
import { SortableResults } from './SortableResults'

const LABELS = {
  en: {
    none: 'No products match',
    results: 'results for',
    hint: 'Type a search above.',
  },
  fr: {
    none: 'Aucun produit pour',
    results: 'résultats pour',
    hint: 'Tapez une recherche ci-dessus.',
  },
}

// A public island rendered on the SERP remote's server. The host caches one
// envelope per query (the props are part of the cache key).
export default async function SearchResults({
  q = '',
  locale = 'en',
}: {
  q?: string
  locale?: string
}) {
  const t = locale === 'fr' ? LABELS.fr : LABELS.en
  const query = q.trim().slice(0, 64)
  if (!query) return <p>{t.hint}</p>
  const hits = search(query).map((p) => ({
    sku: p.sku,
    name: productName(p, locale),
    price: p.price,
    label: formatPrice(p.price, locale),
  }))
  return (
    <section>
      {hits.length === 0 ? (
        <p>
          {t.none} “{query}”.
        </p>
      ) : (
        <>
          <p>
            {hits.length} {t.results} “{query}”
          </p>
          <SortableResults hits={hits} />
        </>
      )}
      <small className="serp-build">remote build {__BUILD_ID__}</small>
    </section>
  )
}
