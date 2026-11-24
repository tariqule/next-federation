# NF-002: Invalid federation configuration

## Why This Error Occurred

The object passed to `defineFederation()` or `withNextFederation()`, or an island component option, failed validation. The message names the offending path.

## Possible Ways to Fix It

- Plain `http` URL: use `https`. Plain `http` is accepted only for localhost, in development and test, or with `allowInsecureHttp: true`.

  ```ts
  remotes: { shop: { origin: 'https://shop.example.com' } }
  ```

- `cacheComponents` on Next.js 15: remove it, or upgrade to Next.js 16.
- `blocking` without `private`: remove it, or make the island `private`.
- Missing `react-server-dom-webpack`: install it at exactly your React's version:

  ```npm
  npm install --save-exact react-server-dom-webpack@<react version>
  ```

- A warning from a components remote's dev server: keep the standalone app in its own Vite config.

## Useful Links

- [Getting started: App Router](../guides/getting-started-app-router.mdx#define-the-federation)
- [Keeping a standalone app](../guides/remote-components.md#keeping-a-standalone-app)
