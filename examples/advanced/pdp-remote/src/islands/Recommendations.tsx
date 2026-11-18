import './pdp.css'
import { Link } from '@next-federation/island'
import { productName, related } from 'example-catalog-data'

// A public island: products related to `sku`. Its links navigate the host
// with the host's router; Link adds the basePath and locale.
export default async function Recommendations({
  sku,
  locale = 'en',
}: {
  sku: string
  locale?: string
}) {
  return (
    <nav className="pdp-recs" aria-label="Recommended products">
      {related(sku).map((p) => (
        <Link key={p.sku} href={`/p/${p.sku}`}>
          {productName(p, locale)}
        </Link>
      ))}
    </nav>
  )
}
