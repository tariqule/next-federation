/** Set on a Server Action by `requireIdentity`; checked before its arguments are decoded. */
export const REQUIRES_IDENTITY: unique symbol = Symbol.for(
  'next-federation.requires-identity'
) as never

const SERVER_REFERENCE = Symbol.for('react.server.reference')

/**
 * The bundler-specific half of the action route. The Vite plugin implements it with
 * `@vitejs/plugin-rsc` (`loadServerAction`, `decodeReply`, `renderToReadableStream`).
 */
export type ActionRuntime = {
  /** Resolves the export behind an action id. May throw or return anything for unknown ids. */
  loadAction(id: string): Promise<unknown>
  /** Decodes an `encodeReply` body into the argument list. */
  decodeReply(body: string | FormData): Promise<unknown>
  /** Renders `{ returnValue }` as a Flight stream. `onError` sees errors while rendering. */
  encodeResult(
    value: { returnValue: unknown },
    onError: (error: unknown) => void
  ): ReadableStream<Uint8Array>
}

/**
 * Marks a Server Action as requiring a verified identity: without a valid token the
 * remote answers `401 NF-014` before decoding any arguments. Returns `fn` itself.
 *
 * ```ts
 * 'use server'
 * export const placeOrder = requireIdentity(async (sku: string) => { ... })
 * ```
 */
export function requireIdentity<F extends (...args: never[]) => unknown>(
  fn: F
): F {
  Object.defineProperty(fn, REQUIRES_IDENTITY, { value: true })
  return fn
}

export function requiresIdentity(fn: unknown): boolean {
  return (
    typeof fn === 'function' &&
    (fn as unknown as Record<symbol, unknown>)[REQUIRES_IDENTITY] === true
  )
}

/** True when `fn` is a registered server reference for exactly `id`. */
export function isServerReference(
  fn: unknown,
  id: string
): fn is (...args: unknown[]) => unknown {
  if (typeof fn !== 'function') return false
  const ref = fn as unknown as { $$typeof?: unknown; $$id?: unknown }
  return ref.$$typeof === SERVER_REFERENCE && ref.$$id === id
}
