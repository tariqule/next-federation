# example-account-remote

**Remote** (island remote, Vite, remote name `account`). Serves private islands with Server
Actions to the [storefront](../storefront/README.md). It has no UI of its own.

| Island         | Shows                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AccountBadge` | "Hi, Ada · 2 open orders" in the storefront header: a private island streamed into every static page.                 |
| `Profile`      | `updateProfile`: a `<Form>` with `useActionState` (pending) and `useOptimistic` (the new name shows at once).         |
| `Orders`       | `cancelOrder`: an optimistic "cancelling…" state, replaced by the remote's answer or put back with its error message. |
| `Inventory`    | Admins only: checks the `role` claim of the signed token, and refuses everyone else. `restock` checks the role again. |

How the actions work (`src/actions.ts`):

- The browser posts an action straight to this remote's build, with the island's own token for the
  `account` audience. The host's cookies never reach this remote.
- Every action is wrapped in `requireIdentity`, and `vite.config.ts` sets
  `actions: { requireIdentity: true }`: a call without a verified token is refused with `401 NF-014`.
- Actions return `{ ok: false, message }` for failures a user should see, instead of throwing (a
  thrown error is redacted in production builds).
- Actions reach client components as props, from the islands' Server Components.
- The data lives in memory (`src/store.ts`), at most 200 accounts, and resets on restart.

`hosts` lists only the storefront: private islands need a host server that signs tokens.

## Run it

Part of the [commerce platform](../README.md) (`pnpm examples:platform`). Alone:
`pnpm --filter example-account-remote dev`, or `build` then `start` (nf-serve on 127.0.0.1:13403).
The islands need the storefront's public keys (its JWKS route), so run the storefront too. Then
sign in on <http://localhost:13410/store/en/account>, change your name and cancel an order. Turn on
**How is this page built?**: `Profile` and `Orders` are `blocking`, in the first HTML.

Guides: [Server Actions in islands](../../../docs/guides/server-actions.mdx),
[Identity](../../../docs/guides/identity.mdx).
