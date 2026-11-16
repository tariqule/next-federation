import { AsyncLocalStorage } from 'node:async_hooks'
import type { IslandIdentity } from './identity-verify.ts'

type Store = AsyncLocalStorage<IslandIdentity | null>

// One slot per process, so duplicate copies of this package in a server bundle
// share the same store.
const SLOT = Symbol.for('next-federation.identity')
const slots = globalThis as unknown as Record<symbol, Store | undefined>
const store: Store = (slots[SLOT] ??= new AsyncLocalStorage())

/** Runs `fn` with the verified identity (or `null` for anonymous) in scope. */
export function runWithIdentity<T>(
  identity: IslandIdentity | null,
  fn: () => Promise<T>
): Promise<T> {
  return store.run(identity, fn)
}

/** The verified identity of the current request, or `null` outside one / when anonymous. */
export function getIdentity(): IslandIdentity | null {
  return store.getStore() ?? null
}
