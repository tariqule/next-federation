# NF-029: Remote component failed to load

## What happened

A remote component could not be loaded: its build descriptor could not be fetched (HTTP
error, timeout, larger than 1 MiB, not JSON or not a v1 descriptor), or its module failed to load in
the server or the browser. The component's fallback renders; the page still answers 200.

`nf-types` reports `NF-029` too when it cannot download a remote's declarations. That remote keeps
the declarations it had; the other remotes still sync.

## Why

- The remote is down, or `/_nf/components.json` is not served (nf-serve serves it for builds made
  by `nextFederationComponents`). When the descriptor URL answers `404` or an HTML page, the message
  adds a hint: the origin is probably not a components remote (a website, or a Next.js app, which
  cannot be a remote; see
  [Sharing components from a Next.js app](../guides/sharing-components-from-a-next-app.md)).
- On the server, a remote file timed out (3 s per request) or is larger than 10 MB.
- The descriptor is larger than 1 MiB (1,048,576 bytes). It is refused while it streams, never
  buffered whole (`nf-types` applies the same limit).
- In the browser, the remote's assets are unreachable (CORS, network, CSP `script-src`). After a
  server render, the browser keeps the server HTML while it retries (500 ms, 1 s, 2 s) and shows the
  fallback only when every attempt failed.
- `nf-types`: the descriptor, the declarations index or a declaration file answered an HTTP error
  or could not be fetched (network error, redirect, timeout of at least 10 s); the index is larger
  than 1 MiB; a declaration file is larger than 1 MiB, or the remote's files add up to more than
  20 MiB; or the index is not a valid declarations index (more than 2000 `.d.ts` files, or a path
  that is not a plain relative path).

## How to fix

Check that the remote answers `GET /_nf/components.json` and serves `/b/<buildId>/` for the build
it names, that the host's CSP allows the remote's origin in `script-src` and `connect-src`, and
look at the logged cause. When the remote comes back the host picks it up on its own: the
descriptor is fetched again, and a server-side failure is retried after one second. For `nf-types`,
check the logged cause, fix the remote's build when it is the cause (fewer or smaller declaration
files) and run `nf-types` again.
