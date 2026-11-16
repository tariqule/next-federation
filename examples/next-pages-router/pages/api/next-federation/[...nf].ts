// The identity routes remotes and islands call: GET .../jwks (public keys)
// and POST .../token (browser token refresh).
import { createFederationApiHandler } from '@next-federation/next/pages/server'
import { federation, getIdentity } from '../../../lib/federation'

export default createFederationApiHandler(federation, { getIdentity })
