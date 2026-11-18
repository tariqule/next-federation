# NF-020: Remote `base` must be an absolute URL

## What happened

A remote was configured with a `base` that is not an absolute `http:` or `https:` URL (or that has
a query string or hash).

## Why

The host fetches islands from another origin, so a relative path has nothing to resolve against.
`@vitejs/plugin-rsc` also rejects a relative base, and the base is the key of the remote's
flight-client scope.

## How to fix

Use a full URL, for example `https://shop.example.com/`.

See [Writing an island remote](../guides/writing-an-island-remote.md#2-configure-vite).
