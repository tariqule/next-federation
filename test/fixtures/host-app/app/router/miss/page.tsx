import { RouterPage } from '../../../lib/RouterPage'

// A build that accepts @next-federation/router >=9.0.0 only: it uses its own
// copy (the document router), so its link is a full navigation.
export default function Page() {
  return <RouterPage title="router miss" remote="router-miss" dynamic />
}
