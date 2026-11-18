# NF-041: Installed `react-server-dom-webpack` has a known security advisory

## What happened

One of these:

- An island remote's build found a `react-server-dom-webpack` affected by
  [GHSA-xqc2-xf4c-x3h3](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3), unauthenticated remote
  code execution in React Server Components, or an experimental React build that cannot be checked
  against it. `vite build` fails; the Vite dev server logs this as a warning and goes on.
- `nf-serve` found a build whose `nf-build.json` records such a version, or whose
  `reactServerDomWebpack` field is malformed or empty (not a list, a non-string entry, or `[]`). If
  it is the current build, `nf-serve` does not start. An older build is retired: its process is not
  started and its `/b/<build>/` paths answer `410 NF-023`.
- `nf-serve` found builds that record no version (made with an older `@next-federation/vite`). It
  cannot check them and they are probably builds with an affected version, so it logs them once as
  an error; it still serves them.

## Why

An island remote runs `react-server-dom-webpack` on its server to render islands and run Server
Actions. The affected versions are 19.0.0 to 19.0.8, 19.1.0 to 19.1.9, 19.2.0 to 19.2.8 and
19.3.0. The patched versions are **19.0.9**, **19.1.10**, **19.2.9** and **19.3.1**.

What the message contains depends on the case:

- **An affected version**: the version found, where it was found (a folder for `vite build`, the
  build id for `nf-serve`), the advisory, and the first patched version of its minor line with the
  command to install it.
- **An experimental build or a value that is not a release version**: the version found, where it
  was found, the advisory, and that experimental builds cannot be checked against it. It names no
  patched version: it lists the patched releases to choose from.
- **A malformed or empty `reactServerDomWebpack` field** (`nf-serve` only): the build id, that the
  field is malformed, and the advisory.
- **Builds that record no version** (`nf-serve` only): the build ids and the advisory.

React canaries and experimental builds are refused too:

- Every `19.3.0-canary-*` is refused, even a canary published after the fix: React names every
  canary after the 19.3.0 release `19.3.0-canary-*`, so the version cannot tell a fixed canary
  from an affected one.
- Experimental builds (`0.0.0-experimental-*` and other `0.0.0-*` versions) come from React's main
  branch and cannot be checked against the advisory.

An island remote cannot build on a React canary or experimental build until a release line covers
it. Use a patched stable release.

## How to fix

Upgrade `react`, `react-dom` and `react-server-dom-webpack` together, to the same exact patched
version (an island remote keeps all three at one exact version):

```sh
npm install --save-exact react@19.3.1 react-dom@19.3.1 react-server-dom-webpack@19.3.1
```

To stay on your minor line, use its patched version instead (for example `19.2.9`). Remove any
override or resolution that pins an affected version. There is no switch to build with an affected
version.

### Then remove every build made with an affected version

Deploying a patched build is not enough. Earlier builds keep running, and an attacker does not
need a page that links to them:

- **`nf-serve`** keeps the newest 3 builds (and any build younger than 24 hours) running, each in its
  own process, answering `/b/<build>/_nf/*`, Server Actions included. After the patched build is
  deployed, delete every build folder made with an affected version from the `--dir` folder and
  restart `nf-serve`. If you do not know which builds those are, restart it once with
  `--max-builds 1 --min-age-hours 0` so only the current build runs; pages cached from older builds
  show inert islands until the host renders a fresh envelope. `nf-serve` refuses builds that
  record an affected version by itself, but builds made with an older `@next-federation/vite`
  record no version, so remove those yourself.
- **Vercel** keeps every earlier deployment and its Function. Delete the deployments made with an
  affected version (`vercel remove <deployment-url>`, or the dashboard). Until they are deleted,
  keep them behind Deployment Protection (Standard Protection covers generated deployment URLs). With
  Skew Protection on, a request that names an old deployment id reaches that deployment through the
  production domain, so delete those deployments.
- **Any other platform**: stop every server and delete every deployment that still runs a build
  made with an affected version.

See [Writing an island remote](../guides/writing-an-island-remote.md) and
[Self-hosted build retention](../guides/self-hosted-skew.md).
