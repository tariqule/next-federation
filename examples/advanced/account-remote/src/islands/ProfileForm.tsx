'use client'
import { Form } from '@next-federation/island'
import { useActionState, useOptimistic } from 'react'
import type { Result } from '../actions'

type State = { name: string; message: string; ok: boolean }

// <Form> keeps its fields disabled until the island has hydrated (islands
// have no progressive enhancement). useOptimistic shows the new name at once;
// useActionState holds the confirmed one and the pending flag.
export function ProfileForm(props: {
  initialName: string
  action: (displayName: string) => Promise<Result<string>>
}) {
  const [state, submit, pending] = useActionState<State, FormData>(
    async (previous, form) => {
      const wanted = String(form.get('displayName') ?? '')
      setOptimisticName(wanted)
      const result = await props.action(wanted)
      return result.ok
        ? { name: result.value, message: 'Saved.', ok: true }
        : { ...previous, message: result.message, ok: false }
    },
    { name: props.initialName, message: '', ok: true }
  )
  const [optimisticName, setOptimisticName] = useOptimistic(state.name)
  return (
    <Form action={submit}>
      <p className={pending ? 'acct-pending' : undefined}>
        Display name: <b data-testid="display-name">{optimisticName}</b>
        {pending ? ' (saving…)' : ''}
      </p>
      <div className="acct-row">
        <label>
          New name{' '}
          <input name="displayName" defaultValue={state.name} required />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <output className={state.ok ? 'acct-ok' : 'acct-error'}>
        {state.message}
      </output>
    </Form>
  )
}
