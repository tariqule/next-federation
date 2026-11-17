import { OrdersInline } from '../../lib/OrdersInline'
import type { OrdersInlineSearch } from '../../lib/OrdersInline'

// A blocking private island reads cookies() outside any <Suspense>: the
// route must allow blocking, or `next build` fails ("Next.js encountered
// runtime data during prerendering").
export const instant = false

export default function Page(props: { searchParams: OrdersInlineSearch }) {
  return <OrdersInline {...props} />
}
