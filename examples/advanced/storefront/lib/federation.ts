import 'server-only'
import { createFederationRoutes } from '@next-federation/next/routes'
import { createIslands } from '@next-federation/next/server'
import type { AppIdentity } from '@next-federation/next/server'
import { federation } from './federation.config'
import { claimsOf, sessionFrom } from './session'

// App Router: the user for private islands, read from the request. Each
// private island gets its own token, minted for that remote's audience.
const getIdentity: AppIdentity = ({ cookies }) =>
  claimsOf(sessionFrom((name) => cookies.get(name)?.value))

export const { RemoteIsland, revalidateIsland } = createIslands(federation, {
  getIdentity,
})
// GET /store/api/next-federation/jwks and POST .../token, for both routers.
export const routes = createFederationRoutes(federation, { getIdentity })
export { federation }
