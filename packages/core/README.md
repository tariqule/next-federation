# @next-federation/core

`defineFederation(config)` validates the host configuration once and returns the `Federation`
object every `next-federation` adapter consumes.

```ts
import { defineFederation } from '@next-federation/core'

export const federation = defineFederation({
  remotes: { shop: { origin: 'https://shop.example.com' } },
  onEvent: (event) => metrics.record(event),
})

federation.target('shop') // { remote, origin, allowedOrigins, timeoutMs: 3000, retries: 1, maxBytes: 5242880 }
```

Invalid configuration throws `NF-002` naming the offending key; an unknown remote throws `NF-001`.
`target()` returns plain JSON, so it is safe as a `'use cache'` argument.

Defaults: `timeoutMs` 3000 (per-remote values override `islands.timeoutMs`), `retries` 1,
`maxBytes` 5 MiB (`MAX_ENVELOPE_BYTES`; per-remote values override `islands.maxBytes`),
`islands.revalidate` 60, `islands.warnBytes` 102400, `identity.ttlSeconds` 300 (at most 900),
`routesPath` `/api/next-federation`.

Remote origins, `assetOrigins` and `identity.issuer` must use `https` unless the host is `localhost`,
`127.0.0.0/8` or `[::1]`, or `NODE_ENV` is `development` or `test` (else `NF-002`).
`allowInsecureHttp: true` accepts plain `http` anyway and logs a warning once per process.

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

## Remote components

A remote with a `components` key serves Module Federation client components:

```ts
remotes: {
  shop: {
    origin: 'https://shop.example.com',
    components: {
      ssr: { publicKeys: [SHOP_PUBLIC_JWK] }, // or { pinned: { b1: 'sha384-…' } }, or false
      revalidate: 60, // descriptor cache, seconds (default islands.revalidate)
      maxBuilds: 5, // distinct builds a process keeps loaded
      // name: 'shop',      expected container name
      // ssr.maxAge: 86400  seconds a signed build is accepted after its build time (iat)
    },
  },
}
```

`federation.componentTarget(name)` returns its plain-JSON target (`NF-002` without `components`).
`ssr.integrity: 'unsafe-dev'` is allowed only when `NODE_ENV` is `development` or `test` (`NF-002`).
`defineFederation` registers each remote's trust policy (server only) in a process-wide registry,
and `verifyComponentDescriptor` records every verified descriptor there; the server loader trusts
nothing else. `@next-federation/core/components`
has `fetchComponentDescriptor(target, { init })` (never throws for remote failures: `NF-029`, or
`NF-005` for a build on another origin) and `verifyComponentDescriptor(target, file)`, which keeps
server rendering only for a descriptor signed by a configured key (ES256, any key: rotation) or
matching a pinned digest. Events: `component:descriptor`, `component:error`.

## Install

```sh
pnpm add @next-federation/core
```

## API

| Export                                                  | Entry                              | Purpose                                                                     |
| ------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `defineFederation(config)`                              | `@next-federation/core`            | Validate the host config and return a `Federation`.                         |
| `fetchIsland(federation, request)`                      | `@next-federation/core`            | Fetch and validate an island envelope, with timeout and retry.              |
| `islandTags`, `eventFor`, `MAX_ENVELOPE_BYTES`          | `@next-federation/core`            | Cache tags, event helpers and the default island body limit.                |
| `generateSigningKey`, `publicJwks`, `validateIdentity`  | `@next-federation/core/identity`   | Signing keys, JWKS and boot-time validation (server only).                  |
| `mintIslandToken`, `identityKey`                        | `@next-federation/core/identity`   | Mint a per-remote island token and derive its cache identity key.           |
| `fetchComponentDescriptor`, `verifyComponentDescriptor` | `@next-federation/core/components` | Remote components: fetch and verify a components remote's build descriptor. |

The wire format is specified in [`docs/protocol/v1.md`](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md).

License: MIT

## Constraints

- Remote names match `NAME_PATTERN` (`^[A-Za-z][A-Za-z0-9_-]*$`). A remote `origin` has no path, query or credentials.
- `fetchIsland` reads at most `maxBytes` of a response body (5 MiB by default), then cancels the body and aborts the request: a larger body is a failed fetch (`NF-007`, not retried) and the island renders its fallback.
- `fetchIsland` refuses redirects (`redirect: 'error'`); a redirect is a failed fetch. The host accepts envelope URLs only from the remote's origin and `assetOrigins`.
- `identity.issuer` is kept exactly as written and compared literally with the token `iss`, so a trailing slash makes a different issuer. Use `https` outside local development.
- Island props are plain JSON (`NF-009`).

Guides: [Identity](https://github.com/tariqule/next-federation/blob/main/docs/guides/identity.md), [Caching](https://github.com/tariqule/next-federation/blob/main/docs/guides/caching.md), [Limits](https://github.com/tariqule/next-federation/blob/main/docs/guides/limits.md).
