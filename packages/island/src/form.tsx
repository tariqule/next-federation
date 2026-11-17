'use client'

import { useEffect, useState } from 'react'
import type { ComponentProps, CSSProperties, ReactElement } from 'react'

export type FormProps = ComponentProps<'form'> & {
  /** Keeps the form disabled even after hydration. */
  disabled?: boolean
}

// A fieldset that looks like nothing: no border, padding, margin or min-width.
const BARE: CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0 }

/**
 * A `<form>` for Server Actions in an island. Its fields sit in a `<fieldset>` that
 * is disabled until the island has hydrated, so nothing can be submitted before the
 * island's action client exists (islands have no progressive enhancement: a submit
 * before hydration would post to the host page). Use it instead of `<form action>`.
 */
export function Form({
  children,
  disabled = false,
  ...rest
}: FormProps): ReactElement {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return (
    <form {...rest}>
      <fieldset disabled={disabled || !hydrated} style={BARE}>
        {children}
      </fieldset>
    </form>
  )
}
