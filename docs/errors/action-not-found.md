# NF-031: Server Action not found

## Why This Error Occurred

The remote answered a Server Action request with `404`: the id in the `X-NF-Action` header is not a `'use server'` function in the build that served the request. Usually the page came from one build and the action went to another, or the export was renamed or removed.

## Possible Ways to Fix It

- Reload the page so the island and its action ids come from the same build.
- Export the function from a file that starts with `'use server'`:

  ```ts
  'use server'

  export async function addToCart(id: string) {}
  ```

- Check that the remote build in use contains the action.

## Useful Links

- [Server Actions: errors](../guides/server-actions.md#errors)
