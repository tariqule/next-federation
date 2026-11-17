import { OrdersInline } from '../../lib/OrdersInline'
import type { OrdersInlineSearch } from '../../lib/OrdersInline'

// Without cacheComponents a blocking private island needs nothing more: the
// route is dynamic (ƒ). Next refuses `instant` here (it is cacheComponents
// only), hence the separate page.cc.tsx.
export default function Page(props: { searchParams: OrdersInlineSearch }) {
  return <OrdersInline {...props} />
}
