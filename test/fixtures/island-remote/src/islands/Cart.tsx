import { addToCart, failing, placeOrder, whoami } from '../actions'
import { ping } from '../linked/ping'
import { ActionButton } from './ActionButton'

// Public island with Server Actions passed to a client component as props.
export default function Cart({ sku }: { sku: string }) {
  return (
    <section data-island="Cart">
      <ActionButton name="add" action={addToCart} args={[sku]} />
      <ActionButton name="whoami" action={whoami} />
      <ActionButton name="order" action={placeOrder} args={[sku]} />
      <ActionButton name="failing" action={failing} />
      <ActionButton name="ping" action={ping} />
    </section>
  )
}
