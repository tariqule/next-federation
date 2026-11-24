# NF-024: Island envelope exceeds the size warning threshold

## Why This Error Occurred

An island envelope is larger than the recommended size, usually because of big props or markup. This is a warning and rendering continues, but it slows every page that embeds the island.

## Possible Ways to Fix It

- Trim props, paginate data, or fetch it from the client after hydration.
- Raise `islands.warnBytes` (102400 by default) if the size is intended:

  ```ts
  // federation.ts
  islands: { warnBytes: 204800 }
  ```

## Useful Links

- [Limits](../guides/limits.mdx)
