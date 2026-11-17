// Same marker as `@next-federation/server`'s `requireIdentity` (a global symbol), without
// pulling server code into browser bundles. 'use server' files normally never run here.
const REQUIRES_IDENTITY = Symbol.for('next-federation.requires-identity')

/** Marks a Server Action as requiring a verified identity (see the server entry). */
export function requireIdentity<F extends (...args: never[]) => unknown>(
  fn: F
): F {
  Object.defineProperty(fn, REQUIRES_IDENTITY, { value: true })
  return fn
}
