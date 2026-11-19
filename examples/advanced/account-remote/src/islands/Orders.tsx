import './account.css'
import { cancelOrder } from '../actions'
import { currentUser } from '../identity'
import { accountOf } from '../store'
import { OrderList } from './OrderList'

// A private island: the orders of the user named in the verified token.
export default async function Orders() {
  const user = currentUser()
  if (!user) throw new Error('Orders needs a signed-in user')
  return (
    <section className="acct-panel">
      <h2>Orders for {user.sub}</h2>
      <OrderList initial={accountOf(user.sub).orders} cancel={cancelOrder} />
      <small className="acct-build">remote build {__BUILD_ID__}</small>
    </section>
  )
}
