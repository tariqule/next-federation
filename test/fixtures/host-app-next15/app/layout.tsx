import Link from 'next/link'
import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">home</Link> | <Link href="/nav/one">nav</Link> |{' '}
          <Link href="/orders">orders</Link>
        </nav>
        {children}
      </body>
    </html>
  )
}
