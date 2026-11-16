'use client'
import { createContext, createElement, useContext, useState } from 'react'

// The hosts' cart state, as a React context. Hosts render <CartProvider>;
// the client-components remote reads it with useCart(). The remote declares
// this package host-provided (`shared` in its vite.config.ts), so it never
// bundles a copy: it gets the host's module and therefore the host's context.
const CartContext = createContext(null)

export function CartProvider({ children }) {
  const [items, setItems] = useState([])
  const add = (sku) => setItems((list) => [...list, sku])
  return createElement(
    CartContext.Provider,
    { value: { items, add } },
    children
  )
}

export function useCart() {
  return useContext(CartContext) ?? { items: [], add() {} }
}
