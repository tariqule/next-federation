import './account.css'
import { Link } from '@next-federation/island'
import { currentUser } from '../identity'
import { accountOf } from '../store'

// A small private island for the storefront header. The header is part of
// every page's static shell; this island streams in per request.
export default async function AccountBadge() {
  const user = currentUser()
  if (!user) throw new Error('AccountBadge needs a signed-in user')
  const { displayName, orders } = accountOf(user.sub)
  const open = orders.filter((o) => o.status === 'open').length
  return (
    <span className="acct-badge">
      Hi, {displayName} · <Link href="/account">{open} open order(s)</Link>
    </span>
  )
}
