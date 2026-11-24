# NF-005: Envelope URL is outside the remote's origins

## Why This Error Occurred

An envelope referenced an asset or bootstrap URL on an origin the remote does not declare, so a misbehaving remote cannot make the host load code from elsewhere.

## Possible Ways to Fix It

- Add a legitimate origin, such as a CDN, to the remote's `assetOrigins`. Its own `origin` is always allowed:

  ```ts
  // federation.ts
  remotes: {
    shop: {
      origin: 'https://shop.example.com',
      assetOrigins: ['https://cdn.example.com'],
    },
  }
  ```

- Otherwise, find out why the remote emitted that URL.

## Useful Links

- [Getting started: App Router](../guides/getting-started-app-router.mdx#define-the-federation)
