# NF-014: Identity token rejected

## Why This Error Occurred

The remote rejected the identity token: it is expired, malformed, signed with an unknown key, or has the wrong audience.

## Possible Ways to Fix It

- Check clock skew between services. The remote allows 30 seconds.
- Check the token's `aud` and `exp` claims.
- Check that the signing key is in the issuer's JWKS and tokens are signed with ES256.
- After adding a key to the JWKS, wait up to 30 seconds for the remote's key cache to refresh.

## Useful Links

- [Identity: key rotation](../guides/identity.md#key-rotation)
