# NF-026: Unsupported `@module-federation/vite` version

## Why This Error Occurred

The `@module-federation/vite` that `@next-federation/vite` resolved is not the version it supports, **1.24.0**. `nextFederationComponents` relies on undocumented details of how it builds a remote's server copy.

## Possible Ways to Fix It

- Remove any override or resolution that replaces `@module-federation/vite`, and let `@next-federation/vite` install its pinned copy:

  ```json
  { "overrides": { "@module-federation/vite": "1.25.0" } }
  ```

## Useful Links

- [Remote components: build the remote](../guides/remote-components/vite-remote.mdx#expose-a-component-and-build-it)
