import { RemoteIsland } from '../../lib/federation'

// A public island with Server Actions on a static page (as in host-app's
// /actions): its actions act as whoever is signed in when they run.
export default function ActionsPage() {
  return (
    <main>
      <h1>Actions</h1>
      <div data-testid="mount-a1">
        <RemoteIsland remote="a" island="Cart" props={{ sku: 'A1' }} />
      </div>
    </main>
  )
}
