# NF-029: Remote component failed to load

## What happened

A remote component could not be loaded: its build descriptor could not be fetched (HTTP
error, timeout, not JSON or not a v1 descriptor), or its module failed to load in the server or the
browser. The component's fallback renders; the page still answers 200.

## Why

- The remote is down, or `/_nf/components.json` is not served (nf-serve serves it for builds made
  by `nextFederationComponents`).
- On the server, a remote file timed out (3 s per request) or is larger than 10 MB.
- In the browser, the remote's assets are unreachable (CORS, network, CSP `script-src`). After a
  server render, the browser keeps the server HTML while it retries (500 ms, 1 s, 2 s) and shows the
  fallback only when every attempt failed.

## How to fix

Check that the remote answers `GET /_nf/components.json` and serves `/b/<buildId>/` for the build
it names, that the host's CSP allows the remote's origin in `script-src` and `connect-src`, and
look at the logged cause. When the remote comes back the host picks it up on its own: the
descriptor is fetched again, and a server-side failure is retried after one second.
