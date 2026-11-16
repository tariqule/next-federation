'use client'
import { useState } from 'react'

export function Quantity() {
  const [n, setN] = useState(1)
  return (
    <div className="shop-quantity">
      <button onClick={() => setN((v) => Math.max(1, v - 1))}>−</button>
      <output>{n}</output>
      <button onClick={() => setN((v) => v + 1)}>+</button>
    </div>
  )
}
