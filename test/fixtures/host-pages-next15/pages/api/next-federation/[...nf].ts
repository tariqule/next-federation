import { createFederationApiHandler } from '@next-federation/next/pages/server'
import { federation, getIdentity } from '../../../lib/federation'

// JWKS for remotes and the browser token endpoint (design §9a).
export default createFederationApiHandler(federation, { getIdentity })
