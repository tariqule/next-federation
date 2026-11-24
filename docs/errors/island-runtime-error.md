# NF-012: Uncaught error inside an island

## Why This Error Occurred

An island's own code threw during render or in an effect and nothing caught it. The island is a separate React root, so the host's error boundaries do not see it. The host stays up and shows the island's `errorFallback`.

## Possible Ways to Fix It

- Fix the error in the remote.
- Pass `errorFallback` to the island in the host to choose what shows while it is broken.

## Useful Links

- [Limits](../guides/limits.md)
- [Deployment: self-hosted nf-serve](../guides/deployment.md#self-hosted-nf-serve)
