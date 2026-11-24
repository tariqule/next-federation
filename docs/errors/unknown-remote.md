# NF-001: Unknown remote

## Why This Error Occurred

A host asked for a remote name that is not declared in `defineFederation()`. The cause is a typo, a missing entry, or a config that was not loaded on this side of the build.

## Possible Ways to Fix It

- Check the name against the `remotes` map, and that the host imports that config module:

  ```ts
  // federation.ts
  export const federation = defineFederation({
    remotes: { shop: { origin: 'https://shop.example.com' } },
  })
  ```

## Useful Links

- [Getting started: App Router](../guides/getting-started-app-router.mdx#define-the-federation)
