# @next-federation/server

Server-side runtime for `next-federation` island remotes. It provides the framework-free island
handler, the identity verifier, HTML cleanup, and `nf-serve`, a self-hosted server that keeps
retired builds online. `nf-describe` describes a Module Federation remote as a remote components build.

## Install

```sh
pnpm add @next-federation/server
```

## `stripIslandHtml(html)`

Removes elements React would hoist or run from island SSR HTML, so the host's React never sees
them: `<script>` (whole element), `<link>`, `<meta>`, `<base>`, `<title>` (outside `<svg>`) and
`<style>` that has a `precedence` or `href` attribute. Everything else is returned byte for byte.

```ts
import { stripIslandHtml } from '@next-federation/server'

const { html, removed } = stripIslandHtml(islandHtml)
// removed: [{ tag: 'link', attrs: ' rel="modulepreload" href="/a.js"/' }]
```

React's form-replay script (emitted before a `<form>` whose `action` is a function) is removed too,
and reported as `{ tag: 'script', attrs: '', known: 'react-form-replay' }`: only an exact copy of a
React release's script, with no attributes, gets `known`.

It is built on the parse5 HTML tokenizer (quoted attributes, comments, CDATA, raw-text elements), not a
regular expression, so `<SCRIPT>`, a `>` inside an attribute value, `</script >` and scripts inside
`<svg>` are handled. Escaped text such as `&lt;script&gt;` is never touched.

This is cleanup of framework output, **not a security boundary**. Hosts only accept envelopes from
allowlisted remotes. Do not use it to sanitize untrusted HTML.

## `createIslandHandler(options)`

A framework-free `(req: Request) => Promise<Response>` that serves island envelopes at
`GET|POST <prefix>/_nf/island/<name>` and `GET <prefix>/_nf/health`. It works with any server that
speaks the Web `Request`/`Response` API. The wire contract is in
[docs/protocol/v1.md](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md); that document owns the status table.

```ts
import { createIslandHandler } from '@next-federation/server'

export const handler = createIslandHandler({
  name: 'shop', // this remote's name; also the token audience
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

Options:

- `hosts` (required): the browser origins allowed to call this remote. Each entry must equal the
  `Origin` header a browser sends: `http` or `https`, lowercase, no path, no trailing slash, no
  credentials. `'*'` and any entry that could never match throw `NF-002` at creation (so a typo
  cannot silently turn into 403s). A request whose `Origin` is not listed gets `403 NF-022` without
  CORS headers.
- `islands` (required): the islands this remote exposes. `private: true` requires a verified token.
  Lookup is by own property, so `constructor` is just an unknown island (`404 NF-021`).
- `issuers`: exact `iss` value to JWKS URL, passed to the identity verifier (see below) with
  `audience: name`. Without it, any token is `401 NF-016` and private islands are unreachable.
- `render(island, props, ctx)`: returns `{ html, rscPayload, css }`. `props` and `ctx.host`
  (`{ basePath, locale }`) are decoded and validated for you; `ctx.idPlaceholder` is a stable token
  (`nfid-<8 hex>-`, from name, island and buildId, not props) that must appear in `html` and
  `rscPayload`. It runs inside `runWithIdentity`, so `getIdentity()` works. Throwing gives a bare
  `500`; the error is logged, never sent. `css` URLs and `bootstrapUrl()` must be absolute (else 500).
- `bootstrapUrl`: absolute URL of the island bootstrap module.
- `maxAge` (default 60): `max-age` of public responses.
- `maxBodyBytes` (default 65536): POST body limit, enforced on `Content-Length` and on bytes read
  (`413`).
- `dev`: logs `NF-018` for each tag `stripIslandHtml` removed from your HTML (except
  `link[rel=modulepreload]` and React's own form-replay script). The HTML is always stripped, in
  every mode.
- `actions`: an `ActionRuntime` (`loadAction`, `decodeReply`, `encodeResult`) that serves Server
  Actions on `<base>/_nf/action`, following the protocol's Server Actions table. The Vite plugin
  supplies it; without it that path is a bare `404`. An export runs only if it is a server reference
  whose `$$id` equals the `X-NF-Action` id (else `404 NF-031`). Actions run inside
  `runWithIdentity`; `Cookie` is never read. A throwing action answers `200` with a rejected
  `returnValue` (message redacted when `mode` is production) and logs `NF-033`.
- `maxActionBodyBytes` (default 1048576): Server Action body limit (`413`).
- `actionsRequireIdentity` (default false): every action needs a verified token (`401 NF-014`).
  For one action, wrap it: `export const placeOrder = requireIdentity(async () => ...)`
  (`requireIdentity` is exported here and from `@next-federation/island`). Both are checked before
  the arguments are decoded.

Order of evaluation: health, `OPTIONS` (always `204`), `Origin` check, then path, method, size,
decoding (`400 NF-004` for malformed `p`/`h`/body), island lookup, identity (`401`/`503`), render.

Caching and CORS: every response carries `Vary: Origin, Authorization`, and every response to an
allowed `Origin` carries the CORS headers, errors included (allow-headers
`Authorization, Content-Type, X-NF-Action`, max-age 600; never `*`). Success without a token is
`Cache-Control: public, max-age=<maxAge>`; any request that presented a token gets
`private, no-store`; all errors are `no-store`.

`corsHeaders(req, hosts)` is the same CORS logic as a plain function, for servers that need to
add the headers to their own responses.

## Identity verification (remote side of per-user islands)

```ts
import { createIdentityVerifier, getIdentity, runWithIdentity } from '@next-federation/server'

const verify = createIdentityVerifier({
  audience: 'shop', // this remote's name, as the host configured it
  issuers: { 'https://host.example.com': 'https://host.example.com/.well-known/jwks.json' },
})

const outcome = await verify(request)
// { kind: 'anonymous' } | { kind: 'verified', identity } | { kind: 'invalid', code } | { kind: 'unavailable' }
if (outcome.kind === 'verified') {
  await runWithIdentity(outcome.identity, () => render()) // getIdentity() inside returns it
}
```

- **Issuer map.** `issuers` maps the exact `iss` value to its JWKS URL and comes from your
  configuration only. The token's unverified `iss` is just a lookup key; no URL is ever built from
  token content. Every issuer and JWKS URL is validated at creation (absolute `https`, else
  `NF-002` is thrown; plain `http` only for `localhost`, `127.0.0.0/8` and `[::1]`, when `NODE_ENV`
  is `development` or `test`, or with `allowInsecureHttp: true`, which warns once). Tokens are ES256 only and must carry `exp`, `iat` and `sub`. `iat` may not be
  more than 30 s in the future or older than `maxAgeSeconds` (default 900, versus the 300 s default
  token lifetime; the host's `ttlSeconds` is capped at 900). Clock skew tolerance is 30 s.
- **Outcomes.** No `Authorization` header: `anonymous`. Malformed, expired, badly signed or
  wrong-audience token: `invalid` with `NF-014` (respond 401). Issuer not in the map: `invalid` with
  `NF-016` (401, no network request is made). JWKS unreachable, timed out (2 s) or answering badly:
  `unavailable` (`NF-015`, respond 503: an outage is not an invalid token). Outcomes never contain
  the token.
- **`getIdentity()`** returns the identity set by `runWithIdentity`, or `null` outside one or when
  anonymous. The store lives in a single `Symbol.for('next-federation.identity')` slot on
  `globalThis` so duplicate copies of this package in one server bundle share it.

### Key rotation

JWKS responses are cached for up to 10 minutes (jose default), and an unknown `kid` triggers at most
one refetch per 30 s (cooldown); during that cooldown tokens signed with a new key are rejected
(`NF-014`). If the JWKS endpoint is down, the cached key set keeps being used, so already-published
keys keep verifying (and a revoked key keeps verifying until the cache expires). To rotate:

1. Add the new key as a **non-first** entry of the host's `identity.signingKeys` so it is published
   but not yet used for signing.
2. Wait at least the JWKS cache max age (10 minutes).
3. Move the new key first, so it signs; keep the old key published until its last token expired.

## `@next-federation/server/node` and `nf-serve`

A self-hosted production server that keeps every retained build of a remote online, so pages and
island responses cached before a deploy still find their build-pinned assets and actions.

```bash
nf-serve --dir ./builds --port 4100 [--host 127.0.0.1] [--current <buildId>] \
  [--max-builds 3] [--min-age-hours 24]
```

```ts
import { serveBuilds, planRetention, toNodeListener } from '@next-federation/server/node'

const served = await serveBuilds({ dir: './builds', port: 4100 })
// served.live, served.retired, served.current, served.port; await served.close()
```

- Layout: `<dir>/<buildId>/{client,rsc,ssr}` plus `nf-build.json` (`{ buildId, builtAt }`).
- Routes: `/b/<build>/assets/*` (immutable, CORS `*`, traversal-safe), `/b/<build>/_nf/*` (that build's
  handler), `/_nf/*` (the current build).
- One child process per live build, each with `NODE_ENV=production`; the router streams request
  bodies (capped at the protocol body limit; `/_nf/action` bodies at `maxActionBodyBytes`, default
  8 MiB, above the build's own 1 MiB action limit so the build's `413` is what callers normally see)
  and never forwards hop-by-hop headers. A build that does not send response headers within
  `upstreamTimeoutMs` (default 30000) answers `504`. The router's own `413`, `502` and `504` carry
  `Access-Control-Allow-Origin: *` and empty bodies. Above the router's ceiling the upload is cut
  off, and a browser may report a network error instead of the `413`; keep the build limit below
  the ceiling.
- `toNodeListener` reads the request body only as the handler reads it. Whatever the handler
  leaves unread (an early `413`, a cancelled read) is drained once the response is sent, as Node does
  for a body no one reads, so the connection stays usable for the next request.
- Retention: the current build (`--current`, or the newest) is always live; so are the newest
  `--max-builds` (3) and any build younger than `--min-age-hours` (24). Others are retired and answer
  `410 {"error":"NF-023"}` (with `Access-Control-Allow-Origin: *`).
- Compression: text files of at least 1 KB (`.js`, `.mjs`, `.cjs`, `.css`, `.json`, `.svg`, `.html`,
  `.map`, `.txt`), descriptors and public JSON envelopes are sent brotli- or gzip-encoded per
  `Accept-Encoding` (q-values honoured), with `Vary: Accept-Encoding`; cache and CORS headers are
  unchanged. Compressed files are cached in memory per path, mtime and size (`compressionCacheBytes`,
  default 64 MiB). Range and `HEAD` requests, images and fonts, bodies the build encoded itself,
  Server Action results and envelopes of requests that carried a token are sent as they are.
- Fail fast: if a build process dies after startup, the failure is logged (NF-012) and `serveBuilds`
  calls its `onExit({ buildId, code, signal })` option. The `nf-serve` CLI then exits non-zero, so run
  it under a supervisor (Docker, systemd, Kubernetes) that restarts it.

- Remote components builds (`nf-build.json` with `kind: "components"`, written by
  `nextFederationComponents`) are static: no process; `/b/<build>/*` serves the files of the
  build's `client/` folder (browser and server chunks, immutable, CORS `*`), except build
  bookkeeping: dot folders and files (`.vite/manifest.json`, `.vite/mf-preload.json`) and
  `mf-stats.json` answer `404`;
  `/b/<build>/nf-components.json` its descriptor, `/_nf/components.json` the current build's
  descriptor (`no-store`), and `/_nf/health` answers itself. Retention and `410` apply unchanged.

See [docs/guides/self-hosted-skew.md](https://github.com/tariqule/next-federation/blob/main/docs/guides/self-hosted-skew.md) for the operator rule.

## `nf-describe`

Turns any built Module Federation 2.0 remote (Rspack, webpack, Vite) into a remote components build
in nf-serve's layout: it records the server entry, hashes the server graph and writes
`nf-components.json` (signed when `NF_COMPONENTS_SIGNING_KEY` holds a private EC P-256 JWK) and
`nf-build.json`.

```bash
nf-describe --dir dist/<buildId> [--ssr-entry server/remoteEntry.js | --no-ssr] \
  [--base <url>] [--build-id <id>] [--types] [--allow-insecure-http]
nf-describe --dir dist/<buildId> --verify [--public-key <JWK JSON | JWK file>]...
```

- `--ssr-entry` or `--no-ssr` is needed only when the build's `client/mf-manifest.json` names no
  server entry (`metaData.ssrRemoteEntry`), as an Rspack or webpack build does not. A Vite build
  made with `@next-federation/vite` already names one, so `--dir` alone re-describes it. Without
  either flag on a manifest that names none, the command fails (`NF-002`).
- **Describing again without `NF_COMPONENTS_SIGNING_KEY` drops an existing signature.** The command
  prints `described (unsigned; ...)` and exits 0. It warns only when `NODE_ENV=production`. Set the
  key every time you describe a build you mean to ship, and run `--verify --public-key` afterwards:
  hosts render an unsigned build in the browser only (`NF-028`).
- Run the installed binary (`node_modules/.bin/nf-describe`, or a `package.json` script). In one
  test, `npx nf-describe --dir ... --verify --public-key ...` lost its flags to npm, so the command
  re-described the build unsigned instead of verifying it. Which npm version caused it is not
  known. Check the output: a verify run prints `the descriptor and every server file match`, a
  describe run prints `described`.

- `--types` (off by default) indexes and signs the declarations in `client/@mf-types/` for hosts'
  `nf-types`; without it the folder is never signed. `--types` on a build without the folder fails
  (`NF-002`).
- `--verify` checks a described build before it ships (`NF-027` otherwise). It checks a types
  index only when the descriptor signs one, so an older build with an unsigned `@mf-types/` folder
  still verifies.

See [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components.md) for the full workflow.

## API

| Export                                                    | Entry                          | Purpose                                                    |
| --------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `createIslandHandler(options)`, `corsHeaders(req, hosts)` | `@next-federation/server`      | Framework-free island endpoint and its CORS logic.         |
| `stripIslandHtml(html)`                                   | `@next-federation/server`      | Remove hoistable and script tags from island HTML.         |
| `createIdentityVerifier(options)`                         | `@next-federation/server`      | Verify host tokens against an issuer map (`NF-014/15/16`). |
| `getIdentity()`, `runWithIdentity(identity, fn)`          | `@next-federation/server`      | Read or set the verified identity for one render.          |
| `requireIdentity(fn)`                                     | `@next-federation/server`      | Refuse a Server Action call without a verified token.      |
| `serveBuilds`, `planRetention`, `toNodeListener`          | `@next-federation/server/node` | Self-hosted multi-build server (also the `nf-serve` CLI).  |

## Constraints

- `hosts` entries are exact origins; `'*'` throws `NF-002`. Retired builds answer `410 NF-023` with CORS `*`.
- `nf-serve` keeps the newest 3 builds or any younger than 24 hours.
- The token `aud` is this remote's `name`; tokens are ES256 only.
- Stripping island HTML is cleanup, not a security boundary.

## Learn more

- [Writing an island remote](https://github.com/tariqule/next-federation/blob/main/docs/guides/writing-an-island-remote.md)
- [Identity](https://github.com/tariqule/next-federation/blob/main/docs/guides/identity.md)
- [Deployment](https://github.com/tariqule/next-federation/blob/main/docs/guides/deployment.md)
- [Self-hosted skew](https://github.com/tariqule/next-federation/blob/main/docs/guides/self-hosted-skew.md)
- [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components.md)
- [Island protocol v1](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md)

License: MIT
