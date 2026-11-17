'use server'
import { getIdentity, requireIdentity } from '@next-federation/island'

declare const __NF_FIXTURE_BUILD__: string

// Server-side carts per user and build (module state: fine for a fixture).
const carts = new Map<string, number>()

/** Who the remote believes is calling, and which build ran the action. */
export async function whoami(): Promise<{
  sub: string | null
  buildId: string
  /** How often src/side-effect.ts was imported (must stay 0). */
  sideEffects: number
}> {
  return {
    sub: getIdentity()?.sub ?? null,
    buildId: __NF_FIXTURE_BUILD__,
    sideEffects:
      (globalThis as { __fixtureSideEffects?: number }).__fixtureSideEffects ??
      0,
  }
}

export async function addToCart(
  sku: string
): Promise<{ sub: string | null; buildId: string; count: number }> {
  const sub = getIdentity()?.sub ?? null
  const key = `${sub ?? 'guest'}:${sku}`
  const count = (carts.get(key) ?? 0) + 1
  carts.set(key, count)
  return { sub, buildId: __NF_FIXTURE_BUILD__, count }
}

/** Refused with 401 NF-014 without a verified token. */
export const placeOrder = requireIdentity(
  async (sku: string): Promise<string> =>
    `order ${sku} for ${getIdentity()!.sub}`
)

/** Always throws: the message must never reach a browser from a production build. */
export async function failing(): Promise<never> {
  throw new Error('fixture secret detail')
}
