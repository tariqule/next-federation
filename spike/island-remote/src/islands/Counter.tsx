'use client'
import { useState } from 'react'

export function Counter() {
  const [n, setN] = useState(0)
  return (
    <button data-testid="counter" onClick={() => setN((v) => v + 1)}>
      count {n}
    </button>
  )
}
