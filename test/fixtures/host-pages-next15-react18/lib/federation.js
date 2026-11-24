// Server-side only: imported from getServerSideProps and API routes, which
// Next strips from the client bundle.
import { defineFederation } from '@next-federation/core'
import { createPagesIslands } from '@next-federation/next/pages/server'

// The e2e harness sets NF_PORT, NF_SIGNING_KEY, NF_REMOTE_A_ORIGIN and
// NF_COMPONENTS_ORIGIN (the 19-only components build, pages/nineteen.jsx);
// installed-host.ts sets NF_COMPONENTS_REACT18_ORIGIN and
// NF_COMPONENTS_PUBLIC_KEY (the react18 components remote and its key).
const ssr = {
  publicKeys: [JSON.parse(process.env.NF_COMPONENTS_PUBLIC_KEY)],
}
export const federation = defineFederation({
  remotes: {
    a: { origin: process.env.NF_REMOTE_A_ORIGIN },
    components: {
      origin: process.env.NF_COMPONENTS_REACT18_ORIGIN,
      components: { ssr },
    },
    components19: {
      origin: process.env.NF_COMPONENTS_ORIGIN,
      components: { ssr },
    },
  },
  identity: {
    issuer: `http://localhost:${process.env.NF_PORT}`,
    signingKeys: process.env.NF_SIGNING_KEY,
  },
})

export const getIdentity = (req) => {
  const sub = req.cookies['nf-user']
  return sub ? { sub } : null
}

export const { getIslandProps } = createPagesIslands(federation, {
  getIdentity,
})
