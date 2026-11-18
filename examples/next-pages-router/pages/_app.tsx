import type { AppProps } from 'next/app'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { CartProvider, useCart } from 'example-cart-context'
import '../styles.css'

function CartCount() {
  const { items } = useCart()
  return <span className="cart-count">Cart: {items.length}</span>
}

export default function App({ Component, pageProps }: AppProps) {
  const { locale, asPath } = useRouter()
  const other = locale === 'fr' ? 'en' : 'fr'
  return (
    // Host state the remote CartButton reads (remote components share context).
    <CartProvider>
      {/* Vercel sets NEXT_PUBLIC_VERCEL_ENV at build time: deployments only. */}
      {process.env.NEXT_PUBLIC_VERCEL_ENV && (
        <p className="demo-banner">
          Live demo of next-federation ·{' '}
          <a href="https://github.com/tariqule/next-federation">
            source on GitHub
          </a>
        </p>
      )}
      <header>
        <strong>Pages Router host</strong>
        <Link href="/">Home</Link>
        <Link href="/orders">My orders</Link>
        <Link href={asPath} locale={other}>
          {other === 'fr' ? 'Français' : 'English'}
        </Link>
        <CartCount />
      </header>
      <p className="role">
        This app is a <b>host</b> (Next.js Pages Router, basePath{' '}
        <code>/shop</code>). It embeds islands from the <code>shop</code> remote
        (vite-remote) and a remote component from the <code>cart</code> remote
        (components-remote).
      </p>
      <Component {...pageProps} />
    </CartProvider>
  )
}
