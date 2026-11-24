import { RouterPage, getRouterPageProps } from '../../lib/router-page'
import type { RouterPageProps } from '../../lib/router-page'

export const getServerSideProps = getRouterPageProps

// A remote link to /router/next: on the basePath host, /base/fr/router/link
// links to /base/fr/router/next.
export default function Page(props: RouterPageProps) {
  return <RouterPage title="router link" {...props} external />
}
