// DEMO ONLY: the "session" is two plain cookies, the name and the role the
// sign-in form posted (no password). Replace this with your real
// authentication; next-federation only needs getIdentity() to return the
// signed-in user. The role is what the account remote's admin island checks:
// the host signs it into the token, so the remote can trust it.
export type Role = 'customer' | 'admin'
export type Session = { user: string; role: Role }

export function sessionFrom(read: (name: string) => string | undefined) {
  const user = read('demo-user')
  // Same rule as the sign-in form: never trust a raw cookie value.
  if (!user || !/^[\w-]{1,32}$/.test(user)) return null
  const role: Role = read('demo-role') === 'admin' ? 'admin' : 'customer'
  return { user, role } satisfies Session
}

/**
 * What getIdentity returns: `sub`, plus claims signed into every island
 * token at its top level (`name`, `role`). Display data and the role only:
 * tokens travel in a header, and every remote that gets one can read them.
 */
export function claimsOf(session: Session | null) {
  return session
    ? { sub: session.user, claims: { name: session.user, role: session.role } }
    : null
}
