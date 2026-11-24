# NF-032: Server Action request is invalid

## Why This Error Occurred

The remote rejected a request to `/_nf/action` with `400` before running any action, or with `413` because the body is over its limit (1 MiB by default). A plain HTML form post or `sendBeacon` call fails this way by design.

## Possible Ways to Fix It

- Call Server Actions through the island runtime. For forms, use `<Form>` from `@next-federation/island` instead of posting to `/_nf/action` by hand.
- Run the same React version in host and remote.
- For a `413`, send less data per action, or raise the limit:

  ```ts
  // vite.config.ts
  nextFederationIslands({ actions: { maxBodyBytes: 4 * 1024 * 1024 } })
  ```

## Useful Links

- [Server Actions: errors](../guides/server-actions-reference.mdx#errors)
