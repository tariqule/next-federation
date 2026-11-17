import Link from 'next/link'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">home</Link> | <Link href="/orders">orders</Link>
        </nav>
        {children}
      </body>
    </html>
  )
}
