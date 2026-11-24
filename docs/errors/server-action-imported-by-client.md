# NF-034: A client module imports a 'use server' file

## Why This Error Occurred

The island build failed because a browser or SSR module imports a file that starts with `'use server'`. In an island remote, Server Actions reach client components only as props from a Server Component. The message names the importing module.

## Possible Ways to Fix It

- Import the action in a Server Component and pass it down as a prop:

  ```tsx
  // app/page.tsx (Server Component)
  import { addToCart } from './actions'
  import { AddToCart } from './AddToCart'

  export default function Page() {
    return <AddToCart action={addToCart} />
  }
  ```

## Useful Links

- [Server Actions in islands](../guides/server-actions.md)
