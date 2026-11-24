import { createFederationApiHandler } from '@next-federation/next/pages/server'
import { federation, getIdentity } from '../../../lib/federation'

// JWKS for remotes and the browser token endpoint.
export default createFederationApiHandler(federation, { getIdentity })
