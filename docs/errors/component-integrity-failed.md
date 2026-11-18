# NF-027: Remote component server code failed its integrity check

## What happened

A remote component build could not be verified, so the host did not run its server code. The
component renders in the browser only (the server sends its fallback). One of these:

- The build descriptor is signed, but by none of the keys in `components.ssr.publicKeys`, or its
  fields differ from the signed payload.
- The build is pinned (`components.ssr.pinned`) and the descriptor's digest is different.
- A server file (the manifest, `remoteEntry.ssr.js` or a chunk) does not match the sha384 the
  verified descriptor lists for it, or is not listed at all. Nothing of that build is evaluated.

## Why

Server rendering a remote component runs the remote's code inside the host's server process, with
access to its environment and secrets. The host only evaluates code whose every file matches a
descriptor it trusts.

## How to fix

- Check that the remote was built with `NF_COMPONENTS_SIGNING_KEY` set to the private key whose
  public half the host lists, or update the host's `publicKeys` (keep the old key listed while
  builds signed with it are still live: rotation).
- For pinned builds, copy the `digest` from the build's `nf-components.json`.
- A file mismatch means the served files are not the ones that were built (a proxy or CDN
  rewriting them, a partial upload, or tampering). Re-deploy the build unchanged.

See [Remote components: integrity](../guides/remote-components.md#integrity-server-rendering).
