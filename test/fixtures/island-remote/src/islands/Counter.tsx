'use client'
import { useId, useState } from 'react'

// `useId`: two copies of one island on a page must still get distinct ids
// (the host gives each mount its own id prefix).
export function Counter() {
  const id = useId()
  const [n, setN] = useState(0)
  return (
    <button id={id} data-testid="counter" onClick={() => setN((v) => v + 1)}>
      count {n}
    </button>
  )
}

/**
 * Renders nothing: its `value` prop exists only in the island's RSC payload,
 * never in its HTML (the measurements count it in host pages).
 */
export function RscMarker(props: { value: string }) {
  void props.value
  return null
}
