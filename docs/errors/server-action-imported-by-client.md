# NF-034: A client module imports a 'use server' file

## What happened

The island build failed because a module bundled for the browser or for SSR imports a file that
starts with `'use server'`.

## Why

In an island remote, Server Actions reach client components only as props passed from a Server
Component. Importing a `'use server'` file directly from a `'use client'` module would ship a client
reference that the remote cannot serve safely across the federation boundary.

## How to fix

Import the action in a Server Component and pass it to the client component as a prop, for example
`<AddToCart action={addToCart} />`. The error message names the importing module.

See [Server Actions in islands](../guides/server-actions.md).
