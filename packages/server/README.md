# @next-federation/server

Server-side runtime for island remotes: the island handler, the identity verifier and HTML cleanup. It ships two CLIs: `nf-serve` (self-hosted server) and `nf-describe` (describes a Module Federation remote as a components build).

## Install

```npm
npm install @next-federation/server
```

## Usage

```ts title="server.ts"
import { createIslandHandler } from '@next-federation/server'

export const handler = createIslandHandler({
  name: 'shop',
  buildId: 'v1',
  mode: 'production',
  reactVersion: '19.2.0',
  hosts: ['https://app.example'],
  issuers: { 'https://app.example': 'https://app.example/.well-known/jwks.json' },
  islands: { Panel: {}, Account: { private: true } },
  bootstrapUrl: () => 'https://shop.example/b/v1/assets/bootstrap.js',
  render: async (island, props, { idPlaceholder, host }) => ({
    html, // SSR markup containing idPlaceholder
    rscPayload, // Flight payload containing idPlaceholder
    css: ['https://shop.example/b/v1/assets/panel.css'],
  }),
})
```

## Entry points

| Entry                          | Exports                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@next-federation/server`      | `createIslandHandler`, `corsHeaders`, `stripIslandHtml`, `createIdentityVerifier`, `getIdentity`, `runWithIdentity`, `requireIdentity`, `REQUIRES_IDENTITY` |
| `@next-federation/server/node` | `serveBuilds`, `planRetention`, `DEFAULT_RETENTION`, `toNodeListener`, `installedVersion`, components build helpers                                         |

## API

### createIslandHandler(options)

Returns a `(req: Request) => Promise<Response>` serving `GET|POST <prefix>/_nf/island/<name>` and `GET <prefix>/_nf/health`. The [island protocol v1](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md) owns the wire contract and the status table.

| Option                   | Type                                                         | Default   | Description                                                                     |
| ------------------------ | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------- |
| `name`                   | `string`                                                     | required  | Remote name and token audience.                                                 |
| `buildId`                | `string`                                                     | required  | The build id.                                                                   |
| `mode`                   | `'development' \| 'production'`                              | required  | The React mode of the build.                                                    |
| `reactVersion`           | `string`                                                     | required  | The island build's React version.                                               |
| `hosts`                  | `string[]`                                                   | required  | Allowed origins. `'*'` throws `NF-002`; others `403 NF-022`.                    |
| `islands`                | `Record<string, { private?: boolean }>`                      | required  | Exposed islands. `private: true` needs a verified token. Unknown: `404 NF-021`. |
| `render`                 | `(island, props, ctx) => Promise<{ html, rscPayload, css }>` | required  | Renders one island (below).                                                     |
| `bootstrapUrl`           | `() => string \| Promise<string>`                            | required  | Absolute URL of the island bootstrap module.                                    |
| `issuers`                | `Record<string, string>`                                     | none      | Issuer to JWKS URL map. Without it, any token is `401 NF-016`.                  |
| `allowInsecureHttp`      | `boolean`                                                    | `false`   | Accept plain-`http` issuers outside loopback and development.                   |
| `maxAge`                 | `number`                                                     | `60`      | `max-age` of public responses, in seconds.                                      |
| `maxBodyBytes`           | `number`                                                     | `65536`   | `POST` body limit (`413`).                                                      |
| `dev`                    | `boolean`                                                    | none      | Log `NF-018` per stripped tag.                                                  |
| `actions`                | `ActionRuntime`                                              | none      | Serves Server Actions. The Vite plugin supplies it.                             |
| `maxActionBodyBytes`     | `number`                                                     | `1048576` | Server Action body limit (`413`).                                               |
| `actionsRequireIdentity` | `boolean`                                                    | `false`   | Every action needs a verified token (`401 NF-014`).                             |

`render` gets `ctx` with `idPlaceholder` (must appear in `html` and `rscPayload`) and `host` (`{ basePath, locale }`). `css` URLs must be absolute. A throw is a bare `500`.

Every response carries `Vary: Origin, Authorization`. A success without a token is `public, max-age=<maxAge>`, one with a token is `private, no-store`, and every error is `no-store`.

### corsHeaders(req, hosts)

The handler's CORS logic as a plain function.

### stripIslandHtml(html)

Removes what React would hoist or run from island SSR HTML (`<script>`, `<link>`, `<meta>`, `<base>`, `<title>`, hoistable `<style>`). Returns `{ html, removed }`. It is not a sanitizer.

```ts
const { html, removed } = stripIslandHtml(islandHtml)
```

### createIdentityVerifier(options)

Returns `(req: Request) => Promise<IdentityOutcome>`. Throws `NF-002` for an invalid issuer or JWKS URL.

| Option              | Type                     | Default  | Description                                                   |
| ------------------- | ------------------------ | -------- | ------------------------------------------------------------- |
| `audience`          | `string`                 | required | This remote's name.                                           |
| `issuers`           | `Record<string, string>` | required | Exact `iss` to JWKS URL. From configuration only.             |
| `maxAgeSeconds`     | `number`                 | `900`    | Reject tokens whose `iat` is older than this.                 |
| `allowInsecureHttp` | `boolean`                | `false`  | Accept plain-`http` issuers outside loopback and development. |

```ts
const verify = createIdentityVerifier({
  audience: 'shop',
  issuers: { 'https://host.example.com': 'https://host.example.com/.well-known/jwks.json' },
})

const outcome = await verify(request)
// { kind: 'anonymous' } | { kind: 'verified', identity } | { kind: 'invalid', code } | { kind: 'unavailable' }
if (outcome.kind === 'verified') {
  await runWithIdentity(outcome.identity, () => render())
}
```

| Outcome       | When                                                      | Respond |
| ------------- | --------------------------------------------------------- | ------- |
| `anonymous`   | No `Authorization` header.                                | render  |
| `verified`    | A valid token.                                            | render  |
| `invalid`     | Bad token (`NF-014`) or issuer not in the map (`NF-016`). | `401`   |
| `unavailable` | JWKS unreachable, timed out (2 s) or bad (`NF-015`).      | `503`   |

Tokens are ES256 and need `exp`, `iat` and `sub`. Skew tolerance is 30 s; JWKS is cached up to 10 minutes. See [Rotate a signing key](https://github.com/tariqule/next-federation/blob/main/docs/guides/identity.mdx#rotate-a-signing-key) for key rotation.

### getIdentity() and runWithIdentity(identity, fn)

`runWithIdentity` exposes `identity` to `fn`. `getIdentity()` returns it, or `null` when outside one or anonymous.

### requireIdentity(fn)

Wraps a Server Action so a call without a verified token is refused (`401 NF-014`). Also exported from `@next-federation/island`.

```ts
export const placeOrder = requireIdentity(async () => {
  // ...
})
```

### serveBuilds(options)

From `@next-federation/server/node`. A self-hosted production server that keeps retained builds of a remote online. It returns `{ live, retired, current, port, close() }`. Operator rules: [Self-hosted skew](https://github.com/tariqule/next-federation/blob/main/docs/guides/self-hosted-skew.mdx).

```ts
import { serveBuilds } from '@next-federation/server/node'

const served = await serveBuilds({ dir: './builds', port: 4100 })
```

| Option                  | Type                                  | Default              | Description                                           |
| ----------------------- | ------------------------------------- | -------------------- | ----------------------------------------------------- |
| `dir`                   | `string`                              | required             | Builds folder: `<dir>/<buildId>/{client,rsc,ssr}`.    |
| `port`                  | `number`                              | required             | Port to bind. `0` picks a free one.                   |
| `host`                  | `string`                              | none                 | Host to bind. `nf-serve` defaults to `127.0.0.1`.     |
| `current`               | `string`                              | the newest build     | The current build id.                                 |
| `retention`             | `{ maxBuilds?, minAgeMs? }`           | `3` builds, 24 hours | Which builds stay live.                               |
| `maxBodyBytes`          | `number`                              | the protocol limit   | Request body cap while proxying.                      |
| `maxActionBodyBytes`    | `number`                              | 8 MiB                | Body cap for `/_nf/action`.                           |
| `upstreamTimeoutMs`     | `number`                              | `30000`              | Wait for a build's response headers. Exceeded: `504`. |
| `compressionCacheBytes` | `number`                              | 64 MiB               | In-memory cache cap for brotli and gzip files.        |
| `onExit`                | `({ buildId, code, signal }) => void` | none                 | On build process death. That build answers `502`.     |

- Retired builds answer `410 {"error":"NF-023"}`.
- An affected `react-server-dom-webpack` build is refused (`NF-041`).
- A `kind: "components"` build is static and serves `/_nf/components.json`.
- Text files of at least 1 KB are sent brotli or gzip encoded.

### planRetention(builds, now, retention, current?)

Returns `{ current, live, retired }` for `{ buildId, builtAt }` entries. Throws `NF-002` for no builds. `DEFAULT_RETENTION` is `{ maxBuilds: 3, minAgeMs: 86400000 }`.

### toNodeListener(handler)

Adapts a Web handler to a Node listener.

### nf-serve

The CLI for `serveBuilds`. Exits non-zero when a build dies, so use a supervisor.

```bash
nf-serve --dir ./builds --port 4100 [--host 127.0.0.1] [--current <buildId>] \
  [--max-builds 3] [--min-age-hours 24]
```

### nf-describe

Writes `nf-components.json` and `nf-build.json` for a built Module Federation 2.0 remote. See [Rspack or webpack remote](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/rspack-remote.mdx).

```bash
nf-describe --dir dist/<buildId> [--ssr-entry server/remoteEntry.js | --no-ssr] \
  [--base <url>] [--build-id <id>] [--types] [--allow-insecure-http]
nf-describe --dir dist/<buildId> --verify [--public-key <JWK JSON | JWK file>]...
```

| Flag                       | Description                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| `--dir`                    | The build folder. Its Module Federation output is in `client/`.             |
| `--ssr-entry`, `--no-ssr`  | Needed when `client/mf-manifest.json` names no `ssrRemoteEntry` (`NF-002`). |
| `--types`                  | Index and sign `client/@mf-types/`. Fails without the folder (`NF-002`).    |
| `--verify`, `--public-key` | Check a described build (`NF-027` otherwise).                               |

The descriptor is signed when `NF_COMPONENTS_SIGNING_KEY` holds a private EC P-256 JWK. Describing without it drops an existing signature and still exits 0, and hosts render an unsigned build in the browser only (`NF-028`). Run the installed binary, not `npx`.

`describeComponentsBuild`, `verifyComponentsBuild`, `runDescribeCli` and the descriptor helpers (`createDescriptorFile`, `collectServerIntegrity`, `collectBrowserAssets`, `collectTypesIndex`, `writeTypesIndex`) are exported from `@next-federation/server/node`.

## Learn more

- [Writing an island remote](https://github.com/tariqule/next-federation/blob/main/docs/guides/writing-an-island-remote.mdx)
- [Identity](https://github.com/tariqule/next-federation/blob/main/docs/guides/identity.mdx)
- [Island protocol v1](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md)

License: MIT
