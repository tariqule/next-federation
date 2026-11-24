# NF-037: Under `next dev`, private island values may reach the browser

## Why This Error Occurred

Under `next dev`, React sends awaited Server Component values to the browser as debug info, and for `@next-federation/next` Next's dev tooling may not leave them out. For a private island this can include cookies, headers, your `getIdentity` result and the island token. The message names the cause: the library runs from outside `node_modules` (linked), or `--disable-source-maps` is set. Production builds never contain this.

## Possible Ways to Fix It

- Keep the dev server on your machine:

  ```sh
  next dev -H 127.0.0.1
  ```

- Drop `--disable-source-maps`.
- Install packed packages (`pnpm pack`) instead of linking, or use `next build && next start`.

## Useful Links

- [Limits: next dev and linked installs](../guides/limits.md#next-dev-and-linked-installs)
