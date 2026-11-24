import { RouterPage } from '../../../lib/RouterPage'

// React Router's Link with no router in the remote: this host's router.
// Dynamic: outside a router, React Router's useLocation reads the search
// params, which a static page does not know (it would render in the
// browser only, as useSearchParams does).
export default function Page() {
  return (
    <RouterPage
      title="router react-router"
      remote="links"
      dynamic
      links={0}
      reactRouter
    />
  )
}
