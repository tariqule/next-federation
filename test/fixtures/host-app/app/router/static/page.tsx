import { RouterPage } from '../../../lib/RouterPage'

// Static: a remote Link and usePathname keep the page prerendered.
export default function Page() {
  return <RouterPage title="router static" external />
}
