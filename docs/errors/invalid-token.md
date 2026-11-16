# NF-014: Identity token rejected

## What happened

The remote rejected the identity token sent with the request.

## Why

The token is expired, malformed, signed with an unknown key, or has the wrong audience.

## How to fix

Check clock skew between services, the token's `aud` and `exp` claims, and that the signing key is published in the issuer's JWKS.
