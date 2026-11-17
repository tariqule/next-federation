import { RemoteIsland } from '../../lib/federation'

// Public islands with Server Actions on a static page: two mounts of remote
// `a` and one of remote `b`. Their actions act as whoever is signed in when
// they run (a token fetched per action), so the page stays cacheable.
export default function ActionsPage() {
  return (
    <main>
      <h1>Actions</h1>
      <div data-testid="mount-a1">
        <RemoteIsland remote="a" island="Cart" props={{ sku: 'A1' }} />
      </div>
      <div data-testid="mount-a2">
        <RemoteIsland remote="a" island="Cart" props={{ sku: 'A2' }} />
      </div>
      <div data-testid="mount-b">
        <RemoteIsland remote="b" island="Cart" props={{ sku: 'B1' }} />
      </div>
    </main>
  )
}
