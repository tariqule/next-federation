# Server Actions in islands

An island can call the `'use server'` functions of the remote that rendered it. The browser posts
straight to that remote's build, so an action always runs on the build that rendered its island.
The host page, its cookies and its router are not involved.

## Write an action

```ts
// src/actions.ts (in the island remote)
'use server'
import { getIdentity, requireIdentity } from '@next-federation/island'

export async function addToCart(sku: string) {
  const user = getIdentity() // the verified token's claims ({ sub, ... }), or null when signed out
  return cart.add(user?.sub ?? 'guest', sku)
}

// Refused with 401 NF-014 when the request has no verified token,
// before the arguments are even decoded.
export const placeOrder = requireIdentity(async (sku: string) => {
  return orders.place(getIdentity()!.sub, sku)
})
```

Pass actions to client components **as props**, from a Server Component:

```tsx
// src/islands/Cart.tsx (Server Component)
import { addToCart } from '../actions'
import { AddToCart } from '../AddToCart'

export default function Cart({ sku }: { sku: string }) {
  return <AddToCart sku={sku} action={addToCart} />
}
```

```tsx
// src/AddToCart.tsx
'use client'
import { Form } from '@next-federation/island'
import { useActionState } from 'react'

export function AddToCart(props: {
  sku: string
  action: (sku: string) => Promise<number>
}) {
  const [count, submit, pending] = useActionState(
    async () => props.action(props.sku),
    0
  )
  return (
    <Form action={submit}>
      <button disabled={pending}>Add ({count})</button>
    </Form>
  )
}
```

A client module that imports a `'use server'` file directly fails the build (and `vite dev`) with
[`NF-034`](../errors/server-action-imported-by-client.md). Such an import would use one page-wide
`callServer`, which can send one island's action to another remote.

## Forms: no progressive enhancement

Islands hydrate after the host page and a cross-origin module load. A native submit before that
would post to the host page. So island forms are **not submittable until the island has
hydrated**:

- `<Form>` from `@next-federation/island` renders its fields inside a `<fieldset disabled>` on the
  server and enables it after hydration. Enter, autofocus, submit buttons and `<button form>` inside
  it do nothing until then (checked in Chromium, Firefox and WebKit).
- A plain `<form action={action}>` or `formAction={action}` warns
  [`NF-035`](../errors/raw-form-action.md) at build and dev time.
- A form that must work without JavaScript belongs in the host, not in an island.

## Who the action runs as

Requests carry `Authorization: Bearer <token>` when the host has a token for the island, never
cookies. `getIdentity()` inside an action returns the verified token's claims (`sub` and any
others the host signed), or `null` when the request had no token.

- **Private islands** use the token of the user they were rendered for.
- **Public islands on a host with `getIdentity`** (Next.js hosts) carry the token endpoint without
  a user marker. Each action fetches a token for whoever is signed in when it runs, so a cached
  public page still acts as the current user and the page stays static.
- When a token is rejected (`401 NF-014`, for example after key rotation), the island drops it,
  fetches a new one and resends once. It never retries `NF-015`, `NF-016` or a 5xx.

### Deny by default

`requireIdentity(fn)` protects one action. A remote whose actions read or change private data
should also refuse every unauthenticated action:

```ts
nextFederationIslands({
  // ...
  actions: { requireIdentity: true },
})
```

The `?island=<name>` query an action request carries is advisory only: action ids are public
(anyone who can load the island can read them) and valid from any island. Protect data per action,
not per island.

## Errors

- An action that throws rejects the caller's promise. In a production build the message is redacted
  and the remote logs [`NF-033`](../errors/action-failed.md). Return an error state (for
  `useActionState`) for failures the user should see.
- `404 NF-031`: the action id is unknown to the build that served the request (usually a page
  rendered by one build calling another). See [action-not-found](../errors/action-not-found.md).
- `400 NF-032`: the request is malformed: wrong header, content type or body.
- Each call is reported to the host as an `island:action` event (`ok`, `status`, `code`, `ms`,
  `retried`; never arguments, results or tokens), on `onEvent` and the bubbling `nf:island` DOM
  event.

## What does not work in a remote action

- `redirect()`, `notFound()`, `cookies()`, `headers()` and anything else from `next/*`: a remote is
  not a Next.js app, and the browser refuses redirects for action requests. Return a value and let
  the island (or the host, through the bridge) navigate.
- Refreshing the island from the server: the response carries only the return value, and only the
  calling island re-renders, from its own client state.

## Limits

- The build's own limit is 1 MiB by default: `actions.maxBodyBytes` in the Vite options (passed to
  the handler as `maxActionBodyBytes`). Larger bodies get the build's `413`, with CORS.
- `nf-serve` (`serveBuilds`) has a separate, higher ceiling for `/_nf/action` bodies, 8 MiB by
  default. It is the `maxActionBodyBytes` option of `serveBuilds()` only; the `nf-serve` CLI has no
  flag for it. Above it, `nf-serve` answers `413` itself (`Access-Control-Allow-Origin: *`). Keep the
  build's limit below the ceiling so callers see the build's answer.
- Run a production `rsc/index.js` with `NODE_ENV=production` (`nf-serve` does). Errors are redacted
  either way, but React chooses its development or production server at runtime.

## Closures and replicas

Actions defined inside Server Components capture their bound arguments, encrypted with a key
`@vitejs/plugin-rsc` generates per build. Replicas that run the same build artifact share it. Replicas
built separately need the same key: set plugin-rsc's `defineEncryptionKey` to a runtime secret.
