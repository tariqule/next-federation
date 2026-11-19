'use client'
import type { ReactNode } from 'react'
import { CartProvider } from 'example-cart-context'
import { SessionProvider } from 'example-session-context'

// Host state that the header remote's components read: the cart and the
// session (who is signed in, display data only).
export function Providers({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <SessionProvider endpoint="/store/api/session">
        {children}
      </SessionProvider>
    </CartProvider>
  )
}
