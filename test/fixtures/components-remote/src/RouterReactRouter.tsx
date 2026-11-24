import { Link, useLocation } from 'react-router'

/**
 * A remote written with React Router, rendered with no router of its own:
 * the build rewires `react-router`, so outside a router its `Link` and
 * `useLocation` go through the host's navigation (full page loads when the
 * host has none).
 */
export default function RouterReactRouter() {
  const { pathname } = useLocation()
  return (
    <span data-testid="rr-link-root">
      <Link to="/router/next" data-testid="rr-link">
        to router next (react-router)
      </Link>{' '}
      <span data-testid="rr-pathname">{pathname}</span>
    </span>
  )
}
