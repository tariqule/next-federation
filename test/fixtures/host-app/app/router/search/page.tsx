import { RouterPage } from '../../../lib/RouterPage'

// Static: useSearchParams renders the component's fallback in the HTML, and
// the browser fills it in after hydration.
export default function Page() {
  return <RouterPage title="router search" links={0} search />
}
