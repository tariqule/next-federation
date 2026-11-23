import { RouterPage, getRouterPageProps } from '../../lib/router-page'
import type { RouterPageProps } from '../../lib/router-page'

export const getServerSideProps = getRouterPageProps

// React Router's Link with no router in the remote: this host's router (on
// the basePath host, /base/fr/router/next).
export default function Page(props: RouterPageProps) {
  return (
    <RouterPage title="router react-router" {...props} show="react-router" />
  )
}
