# NF-008: Island fetch timed out

## What happened

The remote did not answer within the configured timeout. The log line names the island URL
(origin and path, never the query or the token).

## Why

The remote is slow or overloaded, or the timeout is lower than the island's real render time.

A cached public island keeps rendering its last good envelope from this server process while its
remote fails (the log line then ends "rendering its last good envelope (N s old)"); otherwise the
island's `errorFallback` renders. The page stays static either way and retries soon
([Caching](../guides/caching.md#stale-if-error)).

## How to fix

Investigate remote latency first. If the render is legitimately slow, raise `timeoutMs` for that remote in `defineFederation()` (or `islands.timeoutMs` for all remotes; the default is 3000 ms).

See [Getting started: App Router](../guides/getting-started-app-router.md#timeout-and-retries).
