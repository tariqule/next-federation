import './cdp.css'
import {
  formatPrice,
  getCategory,
  productName,
  productsIn,
} from 'example-catalog-data'
import { GridFilters } from './GridFilters'

// A public island: a Server Component the CDP remote renders on its own
// server. The host caches its envelope (static shell) and refreshes it on
// demand with revalidateIsland('cdp'). Props are plain JSON: the host passes
// its locale because React context does not cross into an island.
export default async function ProductGrid({
  category,
  locale = 'en',
}: {
  category: string
  locale?: string
}) {
  const found = getCategory(category)
  if (!found) return <p>No such category.</p>
  const cards = productsIn(category).map((p) => ({
    sku: p.sku,
    name: productName(p, locale),
    price: formatPrice(p.price, locale),
    tags: p.tags,
  }))
  // When this island was rendered: it changes only when the host fetches a
  // new envelope (on "Publish", or after its revalidate time).
  const renderedAt = new Date().toISOString().slice(11, 19)
  return (
    <section>
      <h2>{found.name[locale === 'fr' ? 'fr' : 'en']}</h2>
      {/* A client component of the island: hydrated on the island's React. */}
      <GridFilters cards={cards} />
      <small className="cdp-meta">
        rendered by the CDP remote at {renderedAt} UTC
      </small>
      <small className="cdp-build">remote build {__BUILD_ID__}</small>
    </section>
  )
}
