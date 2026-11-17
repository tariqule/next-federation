# @next-federation/protocol

The bundler-neutral wire contract between `next-federation` hosts and remotes: the island
envelope (`parseEnvelope`, `assertEnvelopeUrls`), the request codec (`encodeIslandRequest`,
`decodeIslandRequest`), `canonicalJson`, `applyIdPrefix`, and the types of the browser bootstrap
module (`IslandBootstrapModule`). It depends only on `@next-federation/sdk` and runs in Node,
workers and browsers.

The published spec is
[`docs/protocol/v1.md`](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md).
A remote that implements it works with any host, without Vite.

```ts
import { encodeIslandRequest, parseEnvelope } from '@next-federation/protocol'

const req = encodeIslandRequest('https://remote.example', 'Panel', { sku: 'A1' })
const envelope = parseEnvelope(await (await fetch(req.url, req)).json())
```

## Install

```sh
pnpm add @next-federation/protocol
```

## API

| Export                                                                         | Purpose                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `parseEnvelope(json)`                                                          | Validate an envelope (`NF-003`, `NF-004`).                                                                   |
| `assertEnvelopeUrls(envelope, origins)`                                        | Require `bootstrap` and `css` on an allowed origin (`NF-005`).                                               |
| `encodeIslandRequest`, `decodeIslandRequest`                                   | Request codec for `GET` island requests.                                                                     |
| `canonicalJson`, `applyIdPrefix`                                               | Deterministic props encoding and per-mount id prefixing.                                                     |
| `PROTOCOL_VERSION`, `ISLAND_PATH`, ...                                         | Protocol constants.                                                                                          |
| `IslandBootstrapModule` and related types                                      | The browser bootstrap contract.                                                                              |
| `parseComponentDescriptorFile`, `componentDescriptorDigest`, `sha384Integrity` | Remote components build descriptor (`/_nf/components.json`): validation, pinned digest, SRI hashes.          |
| `RemoteComponentDescriptor` and related types                                  | What a host passes to `RemoteComponent`.                                                                     |
| `ComponentSharedModule`                                                        | One entry of a descriptor's signed `shared` list: `requiredVersion`, `fallback`, the exposes that import it. |
| `satisfies`, `isSemverVersion`, `isSemverRange`                                | The npm semver subset shared-module negotiation uses (no dependencies).                                      |

License: MIT

## Constraints

- Props are plain JSON (`NF-009` otherwise). `canonicalJson` sorts keys, so equal props give equal URLs.
- Island names match `NAME_PATTERN` (`^[A-Za-z][A-Za-z0-9_-]*$`). A `GET` request carries props in `p`; above 2048 characters of `p` a `POST` is used.
- `bootstrap` and `css` URLs must be `http(s)` and on an allowed origin (`NF-005`).
- An unknown protocol major renders the host fallback (`NF-003`).

See [Limits](https://github.com/tariqule/next-federation/blob/main/docs/guides/limits.md).
