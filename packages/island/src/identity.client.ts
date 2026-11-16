import { NFError } from '@next-federation/sdk'
import type { IslandIdentity } from '@next-federation/server'

/** Server-only. The client build exists so shared modules can import it safely. */
export function getIdentity(): IslandIdentity | null {
  throw new NFError(
    'NF-002',
    'getIdentity() is server-only: call it from a Server Component or Server Action, and pass what you need to client components as props.'
  )
}
