import 'server-only'

// Stands in for the account service's database: in memory, bounded, and
// reset when the remote restarts. Runs on the remote's server only.
export type Order = { id: string; title: string; status: 'open' | 'cancelled' }
type Account = { displayName: string; orders: Order[] }

const MAX_ACCOUNTS = 200
const accounts = new Map<string, Account>()

/** The account of `sub`, created with demo orders on first use. */
export function accountOf(sub: string): Account {
  let account = accounts.get(sub)
  if (!account) {
    // Bounded: drop the oldest account when full (a Map keeps insertion order).
    if (accounts.size >= MAX_ACCOUNTS) {
      accounts.delete(accounts.keys().next().value!)
    }
    account = {
      displayName: sub,
      orders: [
        { id: '1001', title: 'Trail shoe, size 42', status: 'open' },
        { id: '1002', title: 'Camp mug', status: 'open' },
        { id: '1003', title: 'Head torch', status: 'open' },
      ],
    }
    accounts.set(sub, account)
  }
  return account
}

// Stock for the admin inventory (shared by every admin).
export const stock = new Map<string, number>([
  ['A1', 12],
  ['A2', 4],
  ['A3', 0],
  ['B1', 7],
  ['B2', 30],
  ['B3', 2],
])

/** A short pause, so the pending and optimistic states are visible. */
export const latency = () => new Promise((r) => setTimeout(r, 600))
