import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'

function Where() {
  return <span data-testid="internal-pathname">{useLocation().pathname}</span>
}

/**
 * A remote with its own routes: a `MemoryRouter` (`/` and `/inner`) and a
 * React Router `Link` inside it. Inside its own router the rewired
 * `react-router` is the real one, so the link changes the remote's route
 * only: the host's URL never changes.
 */
export default function RouterInternal() {
  return (
    <span data-testid="internal-root">
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={
              <Link to="/inner" data-testid="internal-link">
                to inner
              </Link>
            }
          />
          <Route
            path="/inner"
            element={<span data-testid="internal-page">inner page</span>}
          />
        </Routes>
        <Where />
      </MemoryRouter>
    </span>
  )
}
