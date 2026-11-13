'use server'
import { getIdentity } from '@nf-spike/proto/identity'

// Server-side cart per user (module state: fine for a spike).
const carts = new Map<string, number>()

export async function addToCart(sku: string, qty: number): Promise<string> {
  const sub = getIdentity()?.sub ?? 'anonymous'
  const key = `${sub}:${sku}`
  const n = (carts.get(key) ?? 0) + qty
  carts.set(key, n)
  return `${n} for ${sub}`
}
