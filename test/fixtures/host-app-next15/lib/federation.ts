import 'server-only'
import { defineFederation } from '@next-federation/core'
import { createFederationRoutes } from '@next-federation/next/routes'
import { createIslands } from '@next-federation/next/server'
import type { AppIdentity } from '@next-federation/next/server'
import { lanePort } from '../../../e2e/lane.ts'

// The e2e harness sets NF_PORT, NF_SIGNING_KEY and NF_LANE
// (test/e2e/servers.ts). Remote ports follow the lane; the remotes are the
// Next 16 hosts' remotes.
const port = process.env.NF_PORT ?? String(lanePort(3104))
const remote = (base: number) => ({
  origin: `http://127.0.0.1:${lanePort(base)}`,
})

export const federation = defineFederation({
  remotes: {
    a: remote(4100),
    // Nothing listens here: used by the remote-down case.
    down: remote(4199),
  },
  identity: {
    issuer: `http://localhost:${port}`,
    signingKeys: process.env.NF_SIGNING_KEY!,
  },
})

const getIdentity: AppIdentity = ({ cookies }) => {
  const sub = cookies.get('nf-user')?.value
  return sub ? { sub } : null
}

export const { RemoteIsland } = createIslands(federation, { getIdentity })
export const routes = createFederationRoutes(federation, { getIdentity })
