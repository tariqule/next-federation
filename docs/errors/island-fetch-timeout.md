# NF-008: Island fetch timed out

## Why This Error Occurred

The remote did not answer within the timeout (3000 ms by default). It is slow or overloaded, or the timeout is lower than the island's real render time.

## Possible Ways to Fix It

- Investigate the remote's latency first.
- If the render is legitimately slow, raise `timeoutMs` for that remote, or `islands.timeoutMs` for all remotes:

  ```ts
  // federation.ts
  remotes: { shop: { origin: 'https://shop.example.com', timeoutMs: 8000 } }
  ```

## Useful Links

- [Timeouts and retries](../guides/limits.md#timeouts-and-retries)
- [Caching: stale-if-error](../guides/caching.md#stale-if-error)
