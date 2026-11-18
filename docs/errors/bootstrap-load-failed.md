# NF-011: Island bootstrap failed to load

## What happened

The browser could not load the island's client code: its bootstrap script, or a module the island
needs while it hydrates (a client component's chunk). The island renders its `errorFallback`; without
one, a bootstrap that failed to load leaves the server HTML in place, not interactive (`inert`).

## Why

The script URL returned an error, was blocked by a Content Security Policy, or the network dropped.
Often the remote is down, or the build the page was rendered with was retired (a page kept open, or
served from a cache, across deploys).

## How to fix

Open the bootstrap URL from the envelope in the browser. Allow the remote's origin in `script-src` and make sure the build is still deployed.

See [Content Security Policy](../guides/csp.md) and [Self-hosted build retention](../guides/self-hosted-skew.md).
