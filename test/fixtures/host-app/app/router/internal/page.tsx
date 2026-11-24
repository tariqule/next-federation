import { RouterPage } from '../../../lib/RouterPage'

// The remote's own MemoryRouter: its internal link stays inside it.
export default function Page() {
  return <RouterPage title="router internal" links={0} internal />
}
