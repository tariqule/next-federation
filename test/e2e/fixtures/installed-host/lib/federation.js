import 'server-only'
import { defineFederation } from '@next-federation/core'
import { createFederationRoutes } from '@next-federation/next/routes'
import { createIslands } from '@next-federation/next/server'

// The e2e harness sets NF_PORT, NF_SIGNING_KEY and NF_REMOTE_A_ORIGIN.
export const federation = defineFederation({
  remotes: { a: { origin: process.env.NF_REMOTE_A_ORIGIN } },
  identity: {
    issuer: `http://localhost:${process.env.NF_PORT}`,
    signingKeys: process.env.NF_SIGNING_KEY,
  },
})

const getIdentity = ({ cookies }) => {
  const sub = cookies.get('nf-user')?.value
  return sub ? { sub } : null
}

export const { RemoteIsland } = createIslands(federation, { getIdentity })
export const routes = createFederationRoutes(federation, { getIdentity })
