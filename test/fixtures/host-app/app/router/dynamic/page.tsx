import { RouterPage } from '../../../lib/RouterPage'

// Per-request descriptor (cacheComponents: a PPR hole).
export default function Page() {
  return <RouterPage title="router dynamic" remote="links" dynamic />
}
