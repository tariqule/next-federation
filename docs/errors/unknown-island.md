# NF-021: Unknown island

## What happened

A host asked a remote for an island it does not expose.

## Why

The island name is misspelled, was removed or renamed, or the remote build in use predates it.

The host logs it as [NF-007](island-fetch-failed.md) (HTTP 404) and renders the island's fallback at
once. A JSON 404 from the remote counts as a deliberate removal, whatever its body (this one, or a
gateway's `{"message":"Not Found"}`), so it is not served from the island's last good envelope. An
HTML 404 from a proxy or a CDN is still served stale
([stale-if-error](../guides/caching.md#stale-if-error)).

## How to fix

Check the island name against the remote's exposed islands and confirm the remote version that added it is deployed.

See [Writing an island remote](../guides/writing-an-island-remote.md#3-write-an-island).
