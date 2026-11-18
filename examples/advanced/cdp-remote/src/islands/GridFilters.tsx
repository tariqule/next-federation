'use client'
import { Link } from '@next-federation/island'
import { useState } from 'react'

type Card = { sku: string; name: string; price: string; tags: string[] }

// The grid's tag filter: island state, on the island's own React. Links are
// host-relative: Link adds the host's basePath and locale, and a plain click
// navigates with the host's router (no full page reload).
export function GridFilters({ cards }: { cards: Card[] }) {
  const [tag, setTag] = useState<string | null>(null)
  const tags = [...new Set(cards.flatMap((c) => c.tags))].sort()
  const shown = tag ? cards.filter((c) => c.tags.includes(tag)) : cards
  return (
    <div data-part="GridFilters (client component of the island)">
      <div className="cdp-filters" role="group" aria-label="Filter by tag">
        <button aria-pressed={tag === null} onClick={() => setTag(null)}>
          all
        </button>
        {tags.map((t) => (
          <button key={t} aria-pressed={tag === t} onClick={() => setTag(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="cdp-grid">
        {shown.map((c) => (
          <article key={c.sku} className="cdp-card">
            <Link href={`/p/${c.sku}`}>{c.name}</Link>
            <div>{c.price}</div>
          </article>
        ))}
      </div>
    </div>
  )
}
