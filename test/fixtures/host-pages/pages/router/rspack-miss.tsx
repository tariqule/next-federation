import { RouterPage, routerPageProps } from '../../lib/router-page'
import type { RouterPageProps } from '../../lib/router-page'

export const getServerSideProps = routerPageProps('rspack-router-miss')

// The Rspack build that accepts @next-federation/router >=0.99.0 only: it
// loads its bundled copy (plain links, no basePath or locale). The host link
// goes to the normal Rspack page in the same document.
export default function Page(props: RouterPageProps) {
  return (
    <RouterPage
      title="router rspack miss"
      {...props}
      hostLink="/router/rspack"
    />
  )
}
