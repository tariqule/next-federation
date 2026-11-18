# NF-013: Private island used without identity configuration

## What happened

A private island was requested but no identity settings are configured.

## Why

Private islands need to verify who is asking. Without an issuer and key source the remote cannot authenticate the call, so it refuses.

## How to fix

Configure identity on both sides, or mark the island public if it should not require authentication. On the host, set `identity` in `defineFederation()` and pass `getIdentity` to `createIslands` and the token routes. On the remote, set `issuers`.

See [Identity](../guides/identity.md).
