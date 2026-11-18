# NF-021: Unknown island

## What happened

A host asked a remote for an island it does not expose.

## Why

The island name is misspelled, was removed or renamed, or the remote build in use predates it.

The remote answers `404` with `{"error":"NF-021"}`, so NF-021 is in the remote's own response and
log. The host's log line shows [NF-007](island-fetch-failed.md) with `(HTTP 404)` and never names
NF-021. The host renders the island's fallback at
once: an island the remote removed is not served from its last good envelope
([stale-if-error](../guides/caching.md#stale-if-error)).

## How to fix

Check the island name against the remote's exposed islands and confirm the remote version that added it is deployed.

See [Writing an island remote](../guides/writing-an-island-remote.md#3-write-an-island).
