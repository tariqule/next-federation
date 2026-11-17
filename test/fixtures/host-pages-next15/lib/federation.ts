// Server-side only: imported from getServerSideProps and API routes, which
// Next strips from the client bundle.
import { defineFederation } from '@next-federation/core'
import { createPagesIslands } from '@next-federation/next/pages/server'
import type { PagesIdentity } from '@next-federation/next/pages/server'
import { lanePort } from '../../../e2e/lane.ts'

// The e2e harness sets NF_PORT, NF_SIGNING_KEY and NF_LANE
// (test/e2e/servers.ts). Remote ports follow the lane; the remotes are the
// Next 16 hosts' remotes.
const port = process.env.NF_PORT ?? String(lanePort(3105))
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

export const getIdentity: PagesIdentity = (req) => {
  const sub = req.cookies['nf-user']
  return sub ? { sub } : null
}

export const { getIslandProps } = createPagesIslands(federation, {
  getIdentity,
})
