# Deployment

## The host

Deploy a Next.js host as you do today. Nothing else is required beyond `withNextFederation` and the
JWKS and token route if you use private islands. Add remote origins to the CSP ([CSP](csp.md)).

Set the same remote origins in every environment. A host that cannot reach a remote shows its
fallback; it does not fail the page.

## The remote

A remote is a server. `vite build` writes `dist/<buildId>/{client,ssr,rsc}` and
`dist/<buildId>/nf-build.json`. Assets are pinned to the build: `<base>b/<buildId>/assets/*`.

`NF_BUILD_ID` sets the build id. Without it a build uses a timestamp.

### Vercel

Vercel keeps old deployments reachable, so build-pinned assets and handlers of an earlier build keep
answering, the same behaviour `nf-serve` provides for self-hosting. Whatever you use, `base` must be the absolute URL that hosts
reach the remote at, and the host's cache must not outlive how long an old build stays reachable
([Caching](caching.md)).

### Self-hosted: `nf-serve`

```sh
nf-serve --dir ./dist --port 4100 [--host 127.0.0.1] [--current <buildId>] \
  [--max-builds 3] [--min-age-hours 24]
```

`nf-serve` runs each live build in its own process behind one router, so old pages keep working
after a deploy.

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

**Supervision.** If a build process dies after startup, `nf-serve` logs it (`NF-012`) and exits
non-zero. Run it under Docker, systemd or Kubernetes so it restarts.

Details: [Self-hosted build retention](self-hosted-skew.md) and the
[`@next-federation/server` README](../../packages/server/README.md).

## Other servers

`createIslandHandler` from `@next-federation/server` is a plain `(Request) => Promise<Response>`, so
any server that speaks the Web `Request` and `Response` API can host a remote. The wire contract is in
[docs/protocol/v1.md](../protocol/v1.md).
