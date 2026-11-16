// Server-side only: imported from getServerSideProps, getStaticProps and API
// routes, which Next strips from the client bundle.
import { defineFederation } from '@next-federation/core'
import { createPagesIslands } from '@next-federation/next/pages/server'
import type { PagesIdentity } from '@next-federation/next/pages/server'
import { lanePort } from '../../../e2e/lane.ts'

// The e2e harness sets NF_PORT, NF_SIGNING_KEY, NF_BASE_PATH_FIXTURE and
// NF_LANE (test/e2e/servers.ts). Remote ports follow the lane.
const port = process.env.NF_PORT ?? String(lanePort(3101))
const basePath = process.env.NF_BASE_PATH_FIXTURE ?? ''
const remote = (base: number) => ({
  origin: `http://127.0.0.1:${lanePort(base)}`,
})

export const federation = defineFederation({
  remotes: {
    a: remote(4100),
    b: remote(4101),
    fake: remote(4102),
    // Nothing listens here: used by the remote-down cases.
    down: remote(4199),
  },
  // Remotes fetch `${issuer}/api/next-federation/jwks`, so with a basePath the
  // issuer includes it.
  identity: {
    issuer: `http://localhost:${port}${basePath}`,
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
