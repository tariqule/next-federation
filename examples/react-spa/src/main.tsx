import { CartProvider, useCart } from 'example-cart-context'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CartButton } from './CartButton'
import { Embedded } from './Embedded'
import { ProductPanel } from './ProductPanel'

function CartCount() {
  const { items } = useCart()
  return <span>Cart: {items.length}</span>
}

function App() {
  return (
    <CartProvider>
      {/* Vercel sets VITE_VERCEL_ENV at build time: deployments only. */}
      {import.meta.env.VITE_VERCEL_ENV && (
        <p className="demo-banner">
          Live demo of next-federation ·{' '}
          <a href="https://github.com/tariqule/next-federation">
            source on GitHub
          </a>
        </p>
      )}
      <header>
        <strong>React SPA host</strong>
        <CartCount />
      </header>
      <p className="role">
        This app is a <b>host</b> (React SPA, Vite). In the browser, it embeds
        an island from the <code>shop</code> remote (vite-remote) and a remote
        component from the <code>cart</code> remote (components-remote).
      </p>
      <main>
        <h1>Product A1</h1>
        <Embedded remote="shop" name="ProductPanel">
          <ProductPanel sku="A1" />
        </Embedded>
        <Embedded remote="cart" name="CartButton">
          <CartButton sku="A1" />
        </Embedded>
      </main>
    </CartProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
