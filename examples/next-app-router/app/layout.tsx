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
        {/* Vercel sets NEXT_PUBLIC_VERCEL_ENV at build time: deployments only. */}
        {process.env.NEXT_PUBLIC_VERCEL_ENV && (
          <p className="demo-banner">
            Live demo of next-federation ·{' '}
            <a href="https://github.com/tariqule/next-federation">
              source on GitHub
            </a>
          </p>
        )}
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
