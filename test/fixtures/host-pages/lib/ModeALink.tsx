'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

// A client navigation to the signed remote's page (mode-a.spec.ts: a stalled
// stylesheet never holds it). `data-hydrated`: a click now is a client one.
export function ModeALink() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return (
    <Link href="/mode-a" data-testid="to-mode-a" data-hydrated={hydrated}>
      to Mode A
    </Link>
  )
}
