# NF-024: Island envelope exceeds the size warning threshold

## What happened

An island envelope is larger than the recommended size.

## Why

Large envelopes usually mean big serialized props or markup, which slows every page that embeds the island.

## How to fix

Trim props, paginate data, or fetch it from the client after hydration. This is a warning; rendering still proceeds. The threshold is `islands.warnBytes` in `defineFederation()` (102400 bytes by default).

See [Limits](../guides/limits.md).
