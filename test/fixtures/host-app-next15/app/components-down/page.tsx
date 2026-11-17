import { ComponentsPage } from '../../lib/ComponentsPage'

// Nothing listens on the `down` remote: the component renders its fallback.
export default function Page() {
  return <ComponentsPage remote="down" />
}
