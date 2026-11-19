'use server'
import { requireIdentity } from '@next-federation/island'
import { currentUser } from './identity'
import { accountOf, latency, stock } from './store'
import type { Order } from './store'

// Server Actions of the account remote. The browser posts them straight to
// this remote's build, with the island's audience-scoped token (never the
// host's cookies). requireIdentity() refuses a call without a verified
// token (401 NF-014) before its arguments are decoded; vite.config.ts also
// sets `actions: { requireIdentity: true }` (deny by default).
//
// Failures the user should see are returned, never thrown: a thrown error is
// redacted in production builds.
export type Result<T> = { ok: true; value: T } | { ok: false; message: string }

export const updateProfile = requireIdentity(
  async (displayName: string): Promise<Result<string>> => {
    await latency()
    const name = String(displayName).trim()
    if (name.length < 2 || name.length > 40) {
      return { ok: false, message: 'Use 2 to 40 characters.' }
    }
    accountOf(currentUser()!.sub).displayName = name
    return { ok: true, value: name }
  }
)

export const cancelOrder = requireIdentity(
  async (id: string): Promise<Result<Order[]>> => {
    await latency()
    const { orders } = accountOf(currentUser()!.sub)
    const order = orders.find((o) => o.id === id)
    if (!order) return { ok: false, message: 'No such order.' }
    if (order.status === 'cancelled') {
      return { ok: false, message: `Order #${id} is already cancelled.` }
    }
    order.status = 'cancelled'
    return { ok: true, value: orders.map((o) => ({ ...o })) }
  }
)

// The role is checked again here: action ids are public, so an action must
// never trust that only admins can see the island that calls it.
export const restock = requireIdentity(
  async (sku: string): Promise<Result<number>> => {
    await latency()
    if (!currentUser()!.isAdmin) return { ok: false, message: 'Admins only.' }
    const current = stock.get(sku)
    if (current === undefined) return { ok: false, message: 'No such product.' }
    const next = Math.min(current + 10, 999)
    stock.set(sku, next)
    return { ok: true, value: next }
  }
)
