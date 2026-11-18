import { CartProvider, useCart } from 'example-cart-context'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CartButton } from './CartButton'
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
      <main>
        <h1>Product A1</h1>
        <ProductPanel sku="A1" />
        <CartButton sku="A1" />
      </main>
    </CartProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
