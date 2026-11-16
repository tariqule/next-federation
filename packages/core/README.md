# @next-federation/core

`defineFederation(config)` validates the host configuration once and returns the `Federation`
object every `next-federation` adapter consumes.

```ts
import { defineFederation } from '@next-federation/core'

export const federation = defineFederation({
  remotes: { shop: { origin: 'https://shop.example.com' } },
  onEvent: (event) => metrics.record(event),
})

federation.target('shop') // { remote, origin, allowedOrigins, timeoutMs: 3000, retries: 1 }
```

Invalid configuration throws `NF-002` naming the offending key; an unknown remote throws `NF-001`.
`target()` returns plain JSON, so it is safe as a `'use cache'` argument.

Defaults: `timeoutMs` 3000 (per-remote values override `islands.timeoutMs`), `retries` 1,
`islands.revalidate` 60, `islands.warnBytes` 102400, `identity.ttlSeconds` 300, `routesPath`
`/api/next-federation`.

## Events

`onEvent` receives `island:fetch` and `island:error` events. `federation.emit` never throws: a
throwing `onEvent` handler is caught and logged with `logger.debug` (visible with `NF_DEBUG=1`).
It has no error code, and rendering is never affected.

## Identity

`@next-federation/core/identity` (server only) mints per-remote island tokens and serves the JWKS.
Call `await validateIdentity(federation)` once at startup (for example from `instrumentation.ts`):
it parses every signing key and warms the cache, so a malformed key throws `NF-002` at boot rather
than on the first per-user request. It throws `NF-013` when `identity` is not configured, so only
call it on hosts that use identity.

## Install

```sh
pnpm add @next-federation/core
```

## API

| Export                                                 | Entry                            | Purpose                                                           |
| ------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------- |
| `defineFederation(config)`                             | `@next-federation/core`          | Validate the host config and return a `Federation`.               |
| `fetchIsland(federation, request)`                     | `@next-federation/core`          | Fetch and validate an island envelope, with timeout and retry.    |
| `islandTags`, `eventFor`                               | `@next-federation/core`          | Cache tags and event helpers for adapters.                        |
| `generateSigningKey`, `publicJwks`, `validateIdentity` | `@next-federation/core/identity` | Signing keys, JWKS and boot-time validation (server only).        |
| `mintIslandToken`, `identityKey`                       | `@next-federation/core/identity` | Mint a per-remote island token and derive its cache identity key. |

The wire format is specified in [`docs/protocol/v1.md`](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md).

License: MIT
