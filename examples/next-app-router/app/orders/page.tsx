import { cookies } from 'next/headers'
import { Embedded } from '../../lib/Embedded'
import { RemoteIsland } from '../../lib/federation'

// A private island, rendered by the remote for the signed-in user. Without a
// user no request is made and the errorFallback shows.
export default async function Orders() {
  const user = (await cookies()).get('demo-user')?.value
  return (
    <main>
      <h1>My orders</h1>
      {user ? (
        <form action="/api/session" method="post">
          Signed in as <b>{user}</b> <button>Sign out</button>
        </form>
      ) : (
        // DEMO ONLY: see app/api/session/route.ts.
        <form action="/api/session" method="post">
          <input name="user" placeholder="any name" required />{' '}
          <button>Sign in</button>
        </form>
      )}
      <Embedded remote="shop" name="MyOrders" isPrivate>
        <RemoteIsland
          remote="shop"
          island="MyOrders"
          private
          fallback={<p>loading orders…</p>}
          errorFallback={<p>Sign in to see your orders.</p>}
        />
      </Embedded>
    </main>
  )
}
