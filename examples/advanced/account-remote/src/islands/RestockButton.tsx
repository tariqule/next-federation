'use client'
import { Form } from '@next-federation/island'
import { useActionState } from 'react'
import type { Result } from '../actions'

// One inventory row. `pending` from useActionState disables the button
// while the action runs.
export function RestockButton(props: {
  sku: string
  count: number
  action: (sku: string) => Promise<Result<number>>
}) {
  const [state, submit, pending] = useActionState(
    async (previous: { count: number; message: string }) => {
      const result = await props.action(props.sku)
      return result.ok
        ? { count: result.value, message: '' }
        : { ...previous, message: result.message }
    },
    { count: props.count, message: '' }
  )
  return (
    <tr>
      <td>{props.sku}</td>
      <td>{state.count}</td>
      <td>
        <Form action={submit}>
          <button type="submit" disabled={pending}>
            {pending ? 'Restocking…' : '+10'}
          </button>{' '}
          <output className="acct-error">{state.message}</output>
        </Form>
      </td>
    </tr>
  )
}
