import { RouterPage, routerPageProps } from '../../lib/router-page'
import type { RouterPageProps } from '../../lib/router-page'

export const getServerSideProps = routerPageProps('rspack')

// The RouterLink built by Rspack (its bundled router labelled 0.99.0;
// accepts this host's).
export default function Page(props: RouterPageProps) {
  return <RouterPage title="router rspack" {...props} />
}
