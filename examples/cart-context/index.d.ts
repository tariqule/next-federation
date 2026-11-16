import type { ReactNode } from 'react'

export type Cart = { items: string[]; add(sku: string): void }

export declare function CartProvider(props: { children: ReactNode }): ReactNode
export declare function useCart(): Cart
