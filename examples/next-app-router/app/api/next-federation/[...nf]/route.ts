// The identity routes remotes and islands call: GET /api/next-federation/jwks
// (public keys) and POST /api/next-federation/token (browser token refresh).
import { routes } from '../../../../lib/federation'

export const { GET, POST } = routes
