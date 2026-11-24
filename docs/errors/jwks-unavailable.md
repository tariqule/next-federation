# NF-015: Issuer JWKS could not be fetched

## Why This Error Occurred

The remote could not download the issuer's JSON Web Key Set, so it cannot verify tokens. Verification fails closed: private islands answer `503` until the JWKS is back.

## Possible Ways to Fix It

- Check the issuer's JWKS URL from the remote's network.
- Make sure it answers within 2 seconds and returns a valid JWKS.

## Useful Links

- [Identity](../guides/identity.md)
