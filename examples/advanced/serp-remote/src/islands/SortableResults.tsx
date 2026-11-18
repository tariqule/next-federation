'use client'
import { Link } from '@next-federation/island'
import { useState } from 'react'

type Hit = { sku: string; name: string; price: number; label: string }

// Client-side sorting: island state, on the island's own React.
export function SortableResults({ hits }: { hits: Hit[] }) {
  const [byPrice, setByPrice] = useState(false)
  const shown = byPrice ? [...hits].sort((a, b) => a.price - b.price) : hits
  return (
    <div data-part="SortableResults (client component of the island)">
      <label>
        <input
          type="checkbox"
          checked={byPrice}
          onChange={(e) => setByPrice(e.target.checked)}
        />{' '}
        lowest price first
      </label>
      <ul className="serp-list">
        {shown.map((h) => (
          <li key={h.sku}>
            <Link href={`/p/${h.sku}`}>{h.name}</Link>
            <span className="serp-price">{h.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
