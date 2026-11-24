# NF-007: Island fetch failed

## Why This Error Occurred

The host could not fetch an island from its remote, so the island renders its fallback and the page still answers. The log line names the island, the remote, the URL (never the query or token) and any HTTP status:

```text
NF-007: Island fetch failed. Island "Hello" from remote "shop" failed at https://shop.example.com/_nf/island/Hello (HTTP 503); rendering its fallback.
```

## Possible Ways to Fix It

- Open the logged URL from the host's network and check that the remote is running.
- Check that the remote's `origin` is an island remote, built with `@next-federation/vite` and served by `nf-serve` or `createIslandHandler`. A website or Next.js app cannot be one.
- Check that the island name is one the remote exposes.
- Retry transient failures with `retries`. `502`, `503`, `504` and network errors are retried once by default:

  ```ts
  remotes: { shop: { origin: 'https://shop.example.com', retries: 2 } }
  ```

## Useful Links

- [Caching: stale-if-error](../guides/caching.md#stale-if-error)
- [Sharing components from a Next.js app](../guides/sharing-components-from-a-next-app.md)
- [NF-008: Island fetch timed out](island-fetch-timeout.md)
