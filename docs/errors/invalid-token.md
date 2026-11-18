# NF-014: Identity token rejected

## What happened

The remote rejected the identity token sent with the request.

## Why

The token is expired, malformed, signed with an unknown key, or has the wrong audience.

## How to fix

Check clock skew between services (the remote allows 30 seconds), the token's `aud` and `exp` claims, and that the signing key is published in the issuer's JWKS. Tokens must be signed with ES256. A key added to the JWKS only moments ago may be rejected for up to 30 seconds while the remote's key cache refreshes.

See [Identity: key rotation](../guides/identity.md#key-rotation).
