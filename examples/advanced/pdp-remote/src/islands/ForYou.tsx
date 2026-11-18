import './pdp.css'
import { getIdentity, Link } from '@next-federation/island'
import { PRODUCTS, productName } from 'example-catalog-data'

// A private island: the host signs a short-lived token for the `pdp`
// audience, and this remote verifies it against the host's public keys. The
// remote never renders it without one.
export default async function ForYou({ locale = 'en' }: { locale?: string }) {
  const user = getIdentity()
  if (!user) throw new Error('ForYou needs a signed-in user')
  // Stands in for a personalised ranking: a stable pick per user.
  const offset = [...user.sub].reduce((n, c) => n + c.charCodeAt(0), 0)
  const picks = [0, 1].map((i) => PRODUCTS[(offset + i * 3) % PRODUCTS.length])
  return (
    <section>
      <h3>Picked for {typeof user.name === 'string' ? user.name : user.sub}</h3>
      <nav className="pdp-recs">
        {picks.map((p) => (
          <Link key={p.sku} href={`/p/${p.sku}`}>
            {productName(p, locale)}
          </Link>
        ))}
      </nav>
      <small className="pdp-build">remote build {__BUILD_ID__}</small>
    </section>
  )
}
