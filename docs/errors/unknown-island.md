# NF-021: Unknown island

## Why This Error Occurred

A host asked a remote for an island it does not expose. The name is misspelled, the island was removed or renamed, or the remote build in use predates it. The remote answers `404` with `{"error":"NF-021"}`; the host logs [NF-007](island-fetch-failed.md) with `(HTTP 404)` and renders the island's fallback.

## Possible Ways to Fix It

- Check the island name against the remote's exposed islands.
- Confirm the remote version that added it is deployed.

## Useful Links

- [Writing an island remote: write an island](../guides/writing-an-island-remote.mdx#write-an-island)
- [Caching: stale-if-error](../guides/caching-reference.mdx#stale-if-error)
