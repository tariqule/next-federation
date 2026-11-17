'use client'
import { Form } from '@next-federation/island'
import { useState } from 'react'

type Result = { sub: string | null; buildId: string; count?: number } | string

/**
 * Calls one Server Action from a <Form>. `data-commits` counts this
 * component's commits after a result, so a test can tell one action from two.
 */
export function ActionButton(props: {
  name: string
  action: (...args: string[]) => Promise<Result>
  args?: string[]
}) {
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [calls, setCalls] = useState(0)
  return (
    <Form
      data-testid={`form-${props.name}`}
      action={async () => {
        try {
          const value = await props.action(...(props.args ?? []))
          setResult(typeof value === 'string' ? value : JSON.stringify(value))
          setError('')
        } catch (e) {
          setError(String((e as Error).message ?? e))
        }
        setCalls((n) => n + 1)
      }}
    >
      <input name="note" defaultValue="" autoFocus={props.name === 'add'} />
      <button type="submit" data-testid={`submit-${props.name}`}>
        {props.name}
      </button>
      <output data-testid={`result-${props.name}`} data-calls={calls}>
        {result}
      </output>
      <output data-testid={`error-${props.name}`}>{error}</output>
    </Form>
  )
}
