import 'server-only'
import { getIdentity } from '@next-federation/island'

// The claims the storefront signs into each token (its getIdentity):
// `sub`, plus `name` and `role`. They are verified by the time a Server
// Component or Server Action reads them.
export function currentUser() {
  const identity = getIdentity()
  if (!identity) return null
  return {
    sub: identity.sub,
    name: typeof identity.name === 'string' ? identity.name : identity.sub,
    isAdmin: identity.role === 'admin',
  }
}
