# NF-038: Server Action request failed

## Why This Error Occurred

A Server Action request got a response that is not a Server Action response and carries no NF code: a `5xx`, an unexpected status or content type, no body, or no answer within `actions.timeoutMs`. The caller's promise rejected; the action may or may not have run.

## Possible Ways to Fix It

- Check the remote's server log, and that its `base` URL reaches it through any proxy in front of it.
- Retry the action from your own code if it is safe to run twice. The island runtime does not retry a `5xx`.
- For a timeout, speed up the action or raise `actions.timeoutMs`:

  ```ts
  // vite.config.ts
  nextFederationIslands({ actions: { timeoutMs: 30_000 } })
  ```

## Useful Links

- [Server Actions: errors](../guides/server-actions-reference.mdx#errors)
