# NF-033: Server Action threw an error

## Why This Error Occurred

A Server Action on the remote threw, and the caller's promise rejected. The error came from the action's own code or from something it called.

## Possible Ways to Fix It

- Find the original error in the remote's server log entry for `NF-033`. In production the message sent to the browser is redacted.
- Handle expected failures inside the action and return a value instead of throwing:

  ```ts
  'use server'

  export async function addToCart(formData: FormData) {
    const id = formData.get('id')
    if (typeof id !== 'string') return { error: 'Missing product id' }
    return { error: null }
  }
  ```

## Useful Links

- [Server Actions: errors](../guides/server-actions.md#errors)
