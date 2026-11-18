# Self-hosted build retention

When a remote is redeployed, pages and island responses cached before the deploy still point at the
previous build: its assets (`/b/<build>/assets/*`) and its server actions (`/b/<build>/_nf/*`). A
self-hosted remote therefore keeps every recent build online. `nf-serve` does this for you.

```bash
nf-serve --dir ./builds --port 4100 [--host 127.0.0.1] [--current <buildId>] \
  [--max-builds 3] [--min-age-hours 24]
```

`<dir>/<buildId>/{client,rsc,ssr}` plus `nf-build.json` (`{ "buildId", "builtAt" }`, and for an
island build `"reactServerDomWebpack"`) is one build. Each live island build runs in its own process
(with `NODE_ENV=production`) behind a router. A components remote build is the exception: it is
served as static files, with no process. The router answers these routes:

| Route                | Served by                                                           |
| -------------------- | ------------------------------------------------------------------- |
| `/b/<build>/assets/*` | static files of that build, immutable and cacheable for a year     |
| `/b/<build>/_nf/*`   | that build's island and action handlers                             |
| `/_nf/*`             | the current build                                                   |
| a retired build      | `410` with `{"error":"NF-023"}` (and `Access-Control-Allow-Origin: *`) |

## Retention policy

The current build is `--current`, or the build with the newest `builtAt`. A build is **live** when
it is the current build, among the newest `--max-builds` (default 3), or younger than
`--min-age-hours` (default 24). Everything else is **retired**: its process is not started and every
request for it answers `410 NF-023`. The policy is evaluated at start; a deploy restarts `nf-serve`,
which logs the live builds when it starts.

## Operator rule

Keep builds for at least `max(host island revalidate, stale-if-error window, longest expected open
tab)`, where the stale-if-error window is `max(1 h, 2 × host island revalidate)`: a host may keep
rendering a last good envelope, and so loading its build, that long while the remote fails. Raise
`--min-age-hours` if tabs stay open for days. Deleting a retired build's folder is safe. Before you
rebuild into an output directory, delete that build's folder first so stale files never mix with the
new build. On Vercel the production domain serves only the newest deployment's build: see
[Deploying an island remote on Vercel](deploying-a-remote-on-vercel.md).

## Builds with a security advisory

Every live build runs and answers `/b/<build>/_nf/*`, Server Actions included, whether or not a page
still links to it. After upgrading away from a `react-server-dom-webpack` affected by
[GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3), delete every build folder made with an affected version
and restart `nf-serve`, or restart it once with `--max-builds 1 --min-age-hours 0`.

`nf-build.json` records the `react-server-dom-webpack` versions a build used
(`"reactServerDomWebpack": ["19.3.1"]`). `nf-serve` checks them when it starts (`NF-041`):

- the current build is affected (or experimental): `nf-serve` does not start;
- an older live build is affected: it is retired, so its process is not started and its routes
  answer `410 NF-023`, as for any retired build (it will not come back, so `410` rather than `503`),
  and `nf-serve` logs `NF-041` naming the build and the version;
- a malformed or empty field (not a list, a non-string entry, or `[]`) is refused the same way;
- builds without the field (made with an older `@next-federation/vite`) are served and logged once as
  an `NF-041` error: they are probably builds with an affected version, so remove those yourself.

See [NF-023](../errors/build-retired.md) and [NF-041](../errors/vulnerable-react-server-dom.md).
