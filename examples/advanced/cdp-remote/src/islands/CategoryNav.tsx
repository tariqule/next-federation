import './cdp.css'
import { Link } from '@next-federation/island'
import { CATEGORIES } from 'example-catalog-data'

// The category links, as a public island. Host-relative hrefs: Link adds the
// host's basePath and locale.
export default async function CategoryNav({
  locale = 'en',
}: {
  locale?: string
}) {
  return (
    <nav className="cdp-nav" aria-label="Categories">
      {CATEGORIES.map((c) => (
        <Link key={c.slug} href={`/c/${c.slug}`}>
          {c.name[locale === 'fr' ? 'fr' : 'en']}
        </Link>
      ))}
    </nav>
  )
}
