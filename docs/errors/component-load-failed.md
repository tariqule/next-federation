# NF-029: Remote component failed to load

## Why This Error Occurred

A remote component could not be loaded: its build descriptor could not be fetched or is invalid, or its module failed to load on the server or in the browser. The fallback renders and the page still answers `200`. `nf-types` also reports this code when it cannot download a remote's declarations.

## Possible Ways to Fix It

- Check that the remote answers `GET /_nf/components.json` and serves `/b/<buildId>/`.
- Allow the remote's origin in the host's CSP `script-src` and `connect-src`.
- Read the logged cause. The host retries on its own once the remote is back.
- For `nf-types`, fix the remote's declaration files if they are too large, then run it again.

## Useful Links

- [Remote components: runtime behaviour](../guides/remote-components/reference.mdx#runtime-behaviour)
- [Content Security Policy](../guides/csp.mdx)
- [Sharing components from a Next.js app](../guides/remote-components/sharing-from-a-next-app.mdx)
