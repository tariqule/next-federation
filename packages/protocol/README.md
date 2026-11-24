# @next-federation/protocol

The bundler-neutral wire contract between `next-federation` hosts and remotes: the island envelope, the request codec, the browser bootstrap types and the remote components descriptor. It depends only on `@next-federation/sdk` and runs in Node, workers and browsers.

A remote that implements the [island protocol v1](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md) works with any host, without Vite.

## Install

```npm
npm install @next-federation/protocol
```

## Usage

```ts
import { encodeIslandRequest, parseEnvelope } from '@next-federation/protocol'

const req = encodeIslandRequest('https://remote.example', 'Panel', { sku: 'A1' })
const envelope = parseEnvelope(await (await fetch(req.url, req)).json())
```

## API

### Envelope

| Export                                  | Description                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `parseEnvelope(json)`                   | Validates an envelope and returns an `IslandEnvelope` (`NF-003`, `NF-004`). |
| `assertEnvelopeUrls(envelope, origins)` | Requires `bootstrap` and `css` URLs on an allowed origin (`NF-005`).        |

### Island requests

| Export                                                         | Description                                                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `encodeIslandRequest(base, island, props, { token?, host? }?)` | Builds a `GET` island request, or a `POST` when the props are long.                      |
| `decodeIslandRequest(request)`                                 | Decodes an island request on the remote side.                                            |
| `canonicalJson(value)`                                         | Deterministic JSON with sorted keys: equal props give equal URLs (`NF-009` if not JSON). |
| `applyIdPrefix(envelope, mountId)`                             | Replaces the envelope's `idPlaceholder` with a prefix unique to this mount.              |

### Server Actions

| Export                                | Description                                                |
| ------------------------------------- | ---------------------------------------------------------- |
| `actionEndpoint(publicBase, island?)` | The Server Action endpoint URL for a remote's public base. |
| `isActionId(id)`                      | Checks a `<file>#<export>` Server Action id.               |
| `parseActionRequest(request)`         | Reads a Server Action request into an `ActionRequest`.     |

### Remote components

| Export                                                                                      | Description                                                                                     |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `parseComponentDescriptorFile`, `parseComponentBuildDescriptor`, `parseComponentTypesIndex` | Validate the descriptor served at `/_nf/components.json`, a build descriptor and a types index. |
| `componentDescriptorDigest`, `componentDescriptorBytes`, `componentDescriptorCanonical`     | The pinned digest, and the bytes it covers.                                                     |
| `sha384Integrity`                                                                           | A Subresource Integrity `sha384-` value for a byte string.                                      |
| `componentTrustRegistry`, `verifiedKey`, `isNeverFallback`, `nowSeconds`                    | Trust registry helpers the host and the server loader share.                                    |
| `RemoteComponentDescriptor`                                                                 | The type of the `descriptor` prop of a component made with `createRemoteComponent`.             |
| `ComponentSharedModule`                                                                     | One entry of a descriptor's signed `shared` list.                                               |

### Shared modules and React advisory

| Export                                                                                  | Description                                                                        |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `satisfies`, `isSemverVersion`, `isSemverRange`                                         | The npm semver subset that shared-module negotiation uses.                         |
| `ISLAND_SHARE_SCOPE`, `ISLAND_SHARE_NAMESPACE`, `islandShareScope`, `islandSharedEntry` | The page-wide share scope islands use for React.                                   |
| `checkFlightClientVersion`, `flightClientAdvisoryDetail`, `RSC_ADVISORY`                | Check a `react-server-dom-webpack` version against GHSA-xqc2-xf4c-x3h3 (`NF-041`). |

### URL helpers

| Export                                           | Description                                       |
| ------------------------------------------------ | ------------------------------------------------- |
| `assertSecureUrl`, `isLoopbackHost`, `redactUrl` | The `https` rule for origins and URLs (`NF-002`). |
| `isDevelopmentOrTest`, `parseAllowInsecureHttp`  | Helpers for the `allowInsecureHttp` rule.         |

### Constants

`PROTOCOL_VERSION`, `ISLAND_PATH`, `HEALTH_PATH`, `ACTION_PATH`, `ACTION_HEADER`, `ACTION_ID_PATTERN`, `NAME_PATTERN`, `BUILD_ID_PATTERN`, `SHA384_PATTERN`, `ID_PLACEHOLDER_PATTERN`, `GET_PROPS_LIMIT`, `DEFAULT_MAX_BODY_BYTES`, `DEFAULT_MAX_ACTION_BODY_BYTES`, `FLIGHT_REGISTRY_GLOBAL`, `COMPONENTS_DESCRIPTOR_FILE`, `COMPONENTS_DESCRIPTOR_PATH`, `COMPONENTS_JWS_TYPE`, `DEFAULT_REACT_RANGE`, `HOST_REACT_MODULES`, `MAX_TYPE_FILES`.

### Types

`IslandEnvelope`, `HostContext`, `ReactMode`, `EncodedIslandRequest`, `ActionRequest`, `IslandBootstrapModule`, `IslandBridge`, `IslandHandle`, `MountIslandOptions`, `ActionReport`, `IslandErrorKind`, `IslandSharedEntry`, `IslandShareScope`, `InsecureHttpOptions`, `FlightClientCheck`, and the component descriptor types (`ComponentDescriptorFile`, `ComponentBuildDescriptor`, `ComponentBuildAssets`, `ComponentExposeAssets`, `ComponentBuildTypes`, `ComponentTypesIndex`, `ComponentTrustKind`, `ComponentTrustPolicy`, `ComponentInitLock`, `ComponentTrustRegistry`).

## Limits

- Props are plain JSON. A `GET` request carries them in `p`; above 2048 characters of `p` (`GET_PROPS_LIMIT`) a `POST` is used.
- Island names match `NAME_PATTERN` (`^[A-Za-z][A-Za-z0-9_-]*$`).
- An unknown protocol major renders the host fallback (`NF-003`).

## Learn more

- [Island protocol v1](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md)
- [Limits](https://github.com/tariqule/next-federation/blob/main/docs/guides/limits.mdx)

License: MIT
