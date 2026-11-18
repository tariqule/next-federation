import Link from 'next/link'
import type { ReactNode } from 'react'
import { CartProvider } from 'example-cart-context'
import { CartCount } from '../lib/CartCount'
import './styles.css'

export const metadata = { title: 'next-federation: App Router example' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Host state the remote CartButton reads (remote components share context). */}
        <CartProvider>
          <header>
            <strong>App Router host</strong>
            <Link href="/">Home</Link>
            <Link href="/orders">My orders</Link>
            <CartCount />
          </header>
          {children}
        </CartProvider>
      </body>
    </html>
  )
}
