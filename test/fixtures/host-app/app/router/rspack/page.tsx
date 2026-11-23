import { RouterPage } from '../../../lib/RouterPage'

// The same RouterLink built by Rspack, its bundled router labelled 0.99.0:
// it still uses this host's router.
export default function Page() {
  return <RouterPage title="router rspack" remote="rspack" dynamic />
}
