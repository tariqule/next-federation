# NF-035: Island form uses a raw `action` instead of `<Form>`

## Why This Error Occurred

A component passes a Server Action to a plain `<form action={...}>`, or to a `formAction` outside a `<Form>`. Islands have no progressive enhancement, so a plain form can submit before hydration, and the submission goes to the host page instead of the remote.

## Possible Ways to Fix It

- Replace `<form action={...}>` with `<Form action={...}>` from `@next-federation/island`. It stays disabled until the island has hydrated:

  ```tsx
  import { Form } from '@next-federation/island'

  export function AddToCart({ action }: { action: (data: FormData) => void }) {
    return (
      <Form action={action}>
        <button type="submit">Add</button>
      </Form>
    )
  }
  ```

## Useful Links

- [Server Actions: forms](../guides/server-actions.md#forms-no-progressive-enhancement)
