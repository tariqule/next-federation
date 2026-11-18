# Deployment

## The host

Deploy a Next.js host as you do today. Nothing else is required beyond `withNextFederation` and the
JWKS and token route if you use private islands. Add remote origins to the CSP ([CSP](csp.md)).

Set the same remote origins in every environment. A host that cannot reach a remote shows its
fallback; it does not fail the page.

## The remote

An island remote is a server. `vite build` writes `dist/<buildId>/{client,ssr,rsc}` and
`dist/<buildId>/nf-build.json`. Assets are pinned to the build: `<base>b/<buildId>/assets/*`. A
components remote has no server of its own: its build is static files, and `nf-serve` serves them
without a process per build ([Remote components](remote-components.md#remote-build-it)).

`NF_BUILD_ID` sets the build id. Without it a build uses a timestamp.

### Vercel

Serve the remote from the project's production domain: static assets plus one Vercel Function for
`/_nf/*`. A deployment holds only its own build, and the production domain always serves the newest
deployment, so after a deploy an earlier build's assets answer `404` there. Older deployments stay
reachable only at their generated URLs, behind Deployment Protection. Without Skew Protection (observed on the Hobby plan on 2026-11-16), an island from a cached
envelope of the previous build goes inert until the host renders a fresh one. Setup, observed behaviour and the skew options are in
[Deploying an island remote on Vercel](deploying-a-remote-on-vercel.md).

Whatever you use, `base` must be the absolute URL that hosts reach the remote at, and the host's
cache must not outlive how long an old build stays reachable ([Caching](caching.md)).

### Self-hosted: `nf-serve`

```sh
nf-serve --dir ./dist --port 4100 [--host 127.0.0.1] [--current <buildId>] \
  [--max-builds 3] [--min-age-hours 24]
```

`nf-serve` runs each live island build in its own process behind one router, so old pages keep
working after a deploy.

| Route                 | Served by                                                      |
| --------------------- | -------------------------------------------------------------- |
| `/b/<build>/assets/*` | static files of that build, immutable                          |
| `/b/<build>/_nf/*`    | that build's island handler                                    |
| `/_nf/*`              | the current build                                              |
| a retired build       | `410` with `{"error":"NF-023"}` and CORS `*`                   |

**Retention.** The current build is always live. So are the newest 3 builds (`--max-builds`) and any
build younger than 24 hours (`--min-age-hours`). Every other build is retired: it answers
`410 NF-023`, and the host's island stays inert. The policy is evaluated when `nf-serve` starts, and a
deploy restarts it.

**Operator rule.** Keep builds for at least the longer of your host's island `revalidate` and your
longest expected open browser tab. Raise `--min-age-hours` if tabs stay open for days. Delete a build
folder before rebuilding into it.

**Security advisories.** Old builds keep running, so upgrading away from a vulnerable dependency
means removing the builds made with it. For `react-server-dom-webpack` and
[GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3), `nf-serve` refuses builds
that record an affected version (`NF-041`); delete the others made with an affected version, or
restart once with
`--max-builds 1 --min-age-hours 0`. On Vercel, delete the older deployments. See
[NF-041](../errors/vulnerable-react-server-dom.md).

**Supervision.** If a build process dies after startup, `nf-serve` logs it (`NF-012`) and exits
non-zero. Run it under Docker, systemd or Kubernetes so it restarts.

**Compression.** `nf-serve` compresses what it serves, so you do not need a proxy for it (see
[Compression](#compression)).

Details: [Self-hosted build retention](self-hosted-skew.md) and the
[`@next-federation/server` README](../../packages/server/README.md).

## Compression

Island remotes ship mostly JavaScript, and the sizes in [Limits](limits.md#cost) are gzip sizes:
served uncompressed, the same code is about three times larger.

`nf-serve` compresses by itself, with Node's `zlib`:

- **What**: `.js`, `.mjs`, `.cjs`, `.css`, `.json`, `.svg`, `.html`, `.map` and `.txt` files of at least
  1 KB, the components descriptor, and public JSON island envelopes from a build. Images, fonts and
  other already-compressed formats are sent as they are.
- **How**: brotli when the request's `Accept-Encoding` accepts it, otherwise gzip, otherwise none
  (q-values are honoured: `br;q=0`, `identity` and `*;q=0` all work as specified). Responses carry
  `Content-Encoding` and `Vary: Accept-Encoding`, and keep their `Cache-Control` (`immutable` for build
  assets) and CORS headers. A build file is compressed once per version (path, modification time and
  size) and kept in memory, up to 64 MiB (`compressionCacheBytes`); a file over 8 MiB is compressed
  as it streams instead.
- **What is left alone**: range requests (sent whole and unencoded), `HEAD` (no body; the same
  headers as `GET`), a response the build encoded itself (never encoded twice), Server Action
  results (streamed), and the envelope of a request that carried an identity token. That last one
  holds per-user data next to props the page chose, and the length of a compressed body would let
  an observer learn about that data (BREACH); per-user envelopes are small and fetched
  server to server.

**On any other host, turn compression on.** On Vercel, a CDN, nginx, a cloud bucket or your own
server in front of `createIslandHandler`, enable gzip or brotli for JavaScript, CSS and JSON. Most
CDNs do this by default for those types; a plain object store or a bare Node server does not.

## Other servers

`createIslandHandler` from `@next-federation/server` is a plain `(Request) => Promise<Response>`, so
any server that speaks the Web `Request` and `Response` API can host a remote. The wire contract is in
[docs/protocol/v1.md](../protocol/v1.md).
