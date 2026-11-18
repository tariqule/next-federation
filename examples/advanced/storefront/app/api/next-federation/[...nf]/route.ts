// The identity routes remotes and islands call, for both routers:
// GET /store/api/next-federation/jwks (public keys) and
// POST /store/api/next-federation/token (browser token refresh).
import { routes } from '../../../../lib/federation'

export const { GET, POST } = routes
