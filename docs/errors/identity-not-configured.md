# NF-013: Private island used without identity configuration

## Why This Error Occurred

A private island was requested but identity is not configured. Without an issuer and key source, the remote cannot authenticate the call and refuses it.

## Possible Ways to Fix It

- On the host, set `identity` in `defineFederation()` and pass `getIdentity` to `createIslands` and the token routes.
- On the remote, set `issuers`.
- Or make the island public if it does not need authentication.

## Useful Links

- [Identity](../guides/identity.mdx)
