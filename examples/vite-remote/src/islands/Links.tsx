import './shop.css'
import { Link } from '@next-federation/island'
import { getProducts } from '../data'

// Links to host pages. Write host-relative hrefs: Link adds the host's
// basePath and locale, and a plain click navigates with the host's router
// (no full page reload).
export default async function Links({ current }: { current?: string }) {
  const products = await getProducts()
  return (
    <nav className="shop-links">
      {products
        .filter((p) => p.sku !== current)
        .map((p) => (
          <Link key={p.sku} href={`/products/${p.sku}`}>
            {p.name}
          </Link>
        ))}
    </nav>
  )
}
