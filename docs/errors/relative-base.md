# NF-020: Remote `base` must be an absolute URL

## Why This Error Occurred

A remote's `base` is not an absolute `http:` or `https:` URL, or it has a query string or hash. The host fetches islands from another origin, so a relative path has nothing to resolve against.

## Possible Ways to Fix It

- Use a full URL:

  ```ts
  // vite.config.ts
  export default defineConfig({ base: 'https://shop.example.com/' })
  ```

## Useful Links

- [Writing an island remote: configure Vite](../guides/writing-an-island-remote.md#2-configure-vite)
