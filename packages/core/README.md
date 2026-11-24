# @next-federation/core

Validates the host configuration and returns the `Federation` object every adapter uses. Fetches island envelopes, mints identity tokens and verifies component descriptors. No dependency on Next.js.

## Install

```npm
npm install @next-federation/core
```

## Usage

```ts title="lib/federation.ts"
import { defineFederation } from '@next-federation/core'

export const federation = defineFederation({
  remotes: { shop: { origin: 'https://shop.example.com' } },
  onEvent: (event) => metrics.record(event),
})

federation.target('shop') // { remote, origin, allowedOrigins, timeoutMs: 3000, retries: 1, maxBytes: 5242880 }
```

## Entry points

| Entry                              | Exports                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@next-federation/core`            | `defineFederation`, `fetchIsland`, `islandTags`, `eventFor`, `islandFailureDetail`, `MAX_ENVELOPE_BYTES` |
| `@next-federation/core/identity`   | `generateSigningKey`, `publicJwks`, `validateIdentity`, `mintIslandToken`, `identityKey` (server only)   |
| `@next-federation/core/components` | `fetchComponentDescriptor`, `verifyComponentDescriptor`, `fetchVerifiedComponentDescriptor`              |

## API

### defineFederation(config)

Validates `config` and returns a `Federation`. Invalid config throws `NF-002`.

| Option              | Type                                   | Default                | Description                                    |
| ------------------- | -------------------------------------- | ---------------------- | ---------------------------------------------- |
| `remotes`           | `Record<string, RemoteConfig>`         | required               | Remotes the host can embed, by name.           |
| `islands`           | `object`                               | see below              | Defaults for every remote.                     |
| `identity`          | `{ issuer, signingKeys, ttlSeconds? }` | none                   | Enables private islands. `ttlSeconds` max 900. |
| `allowInsecureHttp` | `boolean`                              | `false`                | Accept plain `http`. Warns.                    |
| `routesPath`        | `string`                               | `/api/next-federation` | JWKS and token routes path.                    |
| `onEvent`           | `(event: FederationEvent) => void`     | none                   | Event observer.                                |

`RemoteConfig`:

| Option         | Type                     | Default             | Description                             |
| -------------- | ------------------------ | ------------------- | --------------------------------------- |
| `origin`       | `string`                 | required            | Origin only, no path.                   |
| `assetOrigins` | `string[]`               | none                | Extra origins for asset URLs.           |
| `timeoutMs`    | `number`                 | `islands.timeoutMs` | Per-request timeout.                    |
| `retries`      | `number`                 | `islands.retries`   | Retries after a failed request.         |
| `maxBytes`     | `number`                 | `islands.maxBytes`  | Largest response body accepted.         |
| `components`   | `RemoteComponentsConfig` | none                | Marks the remote as serving components. |

`islands` defaults: `timeoutMs` 3000, `retries` 1, `maxBytes` 5 MiB, `revalidate` 60, `warnBytes` 102400. Origins must use `https` except on loopback or in development (`NF-002`).

`RemoteComponentsConfig`:

| Option       | Type                                                                     | Default                         | Description                       |
| ------------ | ------------------------------------------------------------------------ | ------------------------------- | --------------------------------- |
| `descriptor` | `string`                                                                 | `${origin}/_nf/components.json` | The descriptor URL.               |
| `revalidate` | `number`                                                                 | `islands.revalidate`            | Seconds the descriptor is cached. |
| `maxBuilds`  | `number`                                                                 | `5`                             | Distinct builds kept loaded.      |
| `name`       | `string`                                                                 | none                            | Expected container name.          |
| `ssr`        | `false` or `{ publicKeys?, pinned?, integrity?: 'unsafe-dev', maxAge? }` | browser only                    | How a build is verified for SSR.  |

```ts
remotes: {
  shop: {
    origin: 'https://shop.example.com',
    components: { ssr: { publicKeys: [SHOP_PUBLIC_JWK] } },
  },
}
```

### Federation

Returned by `defineFederation`: `remotes` (names), `identity` (config or `null`), `routesPath`, `target(remote)` (a plain-JSON `IslandTarget`, safe in `'use cache'`), `componentTarget(remote)` and `emit(event)` (calls `onEvent`, never throws). Unknown remotes throw `NF-001`. `componentTarget` throws `NF-002` without `components`.

### fetchIsland(target, request)

Fetches and validates an island envelope, with timeout and retries. Remote failures return an `IslandResult`, not a throw. A body over `maxBytes` fails with `NF-007`.

```ts
import { fetchIsland } from '@next-federation/core'

const result = await fetchIsland(federation.target('shop'), {
  island: 'ProductPanel',
  props: { sku: 'A1' },
})
```

`request` takes `island`, `props`, `host`, `token`, `fetch` and `init` (merged into the fetch call). A failed result carries `url` and, for a non-island origin, `hint: 'not-an-island-remote'`.

### islandFailureDetail(result)

Formats a failed result for a log.

### islandTags(remote, island?)

Returns the cache tags `nf:<remote>` and `nf:<remote>:<island>`.

### eventFor(target, island, result)

Builds the `FederationEvent` for a result.

### MAX_ENVELOPE_BYTES

Default island body limit, 5 MiB.

### Identity

Import from `@next-federation/core/identity`. Server only.

| Export                              | Description                                                      |
| ----------------------------------- | ---------------------------------------------------------------- |
| `generateSigningKey(kid?)`          | A private ES256 JWK as JSON.                                     |
| `publicJwks(federation)`            | The public half of every key, as `{ keys }`.                     |
| `validateIdentity(federation)`      | Parses keys: `NF-002` if malformed, `NF-013` without `identity`. |
| `mintIslandToken(federation, opts)` | Mints a short-lived token.                                       |
| `identityKey(federation, sub)`      | An opaque per-user marker for cache keys.                        |

### Remote components

Import from `@next-federation/core/components`.

| Export                                                | Description                                         |
| ----------------------------------------------------- | --------------------------------------------------- |
| `fetchComponentDescriptor(target, { init? })`         | Fetches a build descriptor (`NF-029`, `NF-005`).    |
| `verifyComponentDescriptor(target, file)`             | Keeps `ssr` only for a signed or pinned descriptor. |
| `fetchVerifiedComponentDescriptor(target, { init? })` | Does both. Failure is browser-only (`NF-028`).      |

## Learn more

- [Identity](https://github.com/tariqule/next-federation/blob/main/docs/guides/identity.mdx)
- [Caching](https://github.com/tariqule/next-federation/blob/main/docs/guides/caching.mdx)
- [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/overview.mdx)

License: MIT
