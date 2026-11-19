import './account.css'
import { restock } from '../actions'
import { currentUser } from '../identity'
import { stock } from '../store'
import { RestockButton } from './RestockButton'

// A private island for admins only. The storefront signs a `role` claim into
// the token; this remote checks it here (and again in the restock action).
// It trusts that claim because it accepts tokens from one issuer only, the
// storefront (`issuers` in vite.config.ts); a remote trusting several hosts
// would decide permissions from its own data instead. Without the role it
// renders a refusal; the token is signed, so nobody can add the role on the
// way.
export default async function Inventory() {
  const user = currentUser()
  if (!user) throw new Error('Inventory needs a signed-in user')
  if (!user.isAdmin) {
    return (
      <section className="acct-panel" data-testid="inventory-refused">
        <h2>Inventory</h2>
        <p className="acct-error">
          Admins only. {user.sub}&apos;s token has no admin role.
        </p>
      </section>
    )
  }
  return (
    <section className="acct-panel" data-testid="inventory">
      <h2>Inventory</h2>
      <table className="acct-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>In stock</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...stock].map(([sku, count]) => (
            <RestockButton key={sku} sku={sku} count={count} action={restock} />
          ))}
        </tbody>
      </table>
      <small className="acct-build">remote build {__BUILD_ID__}</small>
    </section>
  )
}
