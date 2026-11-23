import { RouterPage, getRouterPageProps } from '../../lib/router-page'
import type { RouterPageProps } from '../../lib/router-page'

export const getServerSideProps = getRouterPageProps

// The remote's own MemoryRouter: its internal link stays inside it.
export default function Page(props: RouterPageProps) {
  return <RouterPage title="router internal" {...props} show="internal" />
}
