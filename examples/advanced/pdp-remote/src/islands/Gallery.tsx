'use client'
import { useState } from 'react'

const COLOURS = ['#2f6f9f', '#9f4f2f', '#3f7f3f']

// Stands in for a product photo gallery: island state on the island's React.
export function Gallery({ sku }: { sku: string }) {
  const [shown, setShown] = useState(0)
  return (
    <div data-part="Gallery (client component of the island)">
      <div className="pdp-photo" style={{ background: COLOURS[shown] }}>
        {sku}
      </div>
      <div className="pdp-thumbs" role="group" aria-label="Photos">
        {COLOURS.map((c, i) => (
          <button
            key={c}
            aria-label={`Photo ${i + 1}`}
            aria-pressed={shown === i}
            style={{ background: c }}
            onClick={() => setShown(i)}
          />
        ))}
      </div>
    </div>
  )
}
