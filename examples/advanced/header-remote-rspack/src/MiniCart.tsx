import { useCart } from 'example-cart-context'
import { Pill } from 'example-design-system'
import { useSession } from 'example-session-context'

/**
 * The mini cart: reads two contexts the host owns, the cart and the session
 * (both host-provided shared modules), and renders a Pill from the shared
 * design system (the host's copy when it passes one, else the copy bundled
 * here).
 */
export default function MiniCart() {
  const { items } = useCart()
  const { user } = useSession()
  return (
    <span className="header-minicart" title={items.join(', ')}>
      {user ? `${user}'s cart` : 'Cart'} <Pill>{items.length}</Pill>
    </span>
  )
}
