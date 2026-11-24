# NF-025: Unsupported `@vitejs/plugin-rsc` version

## Why This Error Occurred

The `@vitejs/plugin-rsc` that `@next-federation/vite` resolved is not the version it supports, **0.5.39**. The plugin is still 0.x and the Vite adapter depends on its internals, which can change in any release.

## Possible Ways to Fix It

- Remove any override or resolution that replaces `@vitejs/plugin-rsc`, and let `@next-federation/vite` install its pinned copy:

  ```json
  { "overrides": { "@vitejs/plugin-rsc": "0.6.0" } }
  ```

## Useful Links

- [Writing an island remote](../guides/writing-an-island-remote.mdx)
