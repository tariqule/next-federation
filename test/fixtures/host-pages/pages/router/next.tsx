import { RouterPage, getRouterPageProps } from '../../lib/router-page'
import type { RouterPageProps } from '../../lib/router-page'

export const getServerSideProps = getRouterPageProps

// Where the remote link points: shows usePathname() after the navigation.
export default function Page(props: RouterPageProps) {
  return <RouterPage title="router next" {...props} />
}
