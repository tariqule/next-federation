import { RouterPage } from '../../../lib/RouterPage'

// Two remote links on one page: one click is one history entry.
export default function Page() {
  return <RouterPage title="router two" links={2} />
}
