'use client'
import { Form } from '@next-federation/island'
import { startTransition, useOptimistic, useState } from 'react'
import type { Result } from '../actions'
import type { Order } from '../store'

type Shown = Order & { pending?: boolean }

// Cancelling is optimistic: the order shows as cancelling at once, and the
// action's answer replaces it (or the error state puts it back).
export function OrderList(props: {
  initial: Order[]
  cancel: (id: string) => Promise<Result<Order[]>>
}) {
  const [orders, setOrders] = useState<Order[]>(props.initial)
  const [message, setMessage] = useState('')
  const [shown, markPending] = useOptimistic<Shown[], string>(
    orders,
    (list, id) => list.map((o) => (o.id === id ? { ...o, pending: true } : o))
  )
  const cancel = (id: string) =>
    startTransition(async () => {
      markPending(id)
      const result = await props.cancel(id)
      if (result.ok) {
        setOrders(result.value)
        setMessage(`Order #${id} cancelled.`)
      } else {
        setMessage(result.message)
      }
    })
  return (
    <>
      <ul>
        {shown.map((o) => (
          <li
            key={o.id}
            className={
              o.pending
                ? 'acct-pending'
                : o.status === 'cancelled'
                  ? 'acct-cancelled'
                  : undefined
            }
          >
            <Form action={() => cancel(o.id)} className="acct-row">
              <span>
                #{o.id} {o.title}
                {o.pending ? ' (cancelling…)' : ''}
              </span>
              {o.status === 'open' && !o.pending && (
                <button type="submit">Cancel</button>
              )}
            </Form>
          </li>
        ))}
      </ul>
      <output>{message}</output>
    </>
  )
}
