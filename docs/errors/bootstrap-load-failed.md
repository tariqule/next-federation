# NF-011: Island bootstrap failed to load

## Why This Error Occurred

The browser could not load the island's client code: its bootstrap script or a chunk it needs to hydrate. The URL returned an error, a Content Security Policy blocked it, or the network dropped. The island renders its `errorFallback`, or without one stays as non-interactive server HTML.

## Possible Ways to Fix It

- Open the bootstrap URL from the envelope in the browser.
- Allow the remote's origin in `script-src`:

  ```text
  Content-Security-Policy: script-src 'self' https://shop.example.com
  ```

- Make sure the build is still deployed. A page kept open across deploys points at a retired build.

## Useful Links

- [Content Security Policy](../guides/csp.mdx)
- [Self-hosted build retention](../guides/self-hosted-skew.mdx)
