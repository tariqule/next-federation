# NF-015: Issuer JWKS could not be fetched

## What happened

The remote could not download the issuer's JSON Web Key Set.

## Why

The JWKS endpoint was unreachable or returned an invalid document, so tokens cannot be verified.

## How to fix

Check the issuer's JWKS URL from the remote's network. The remote waits 2 seconds for the JWKS. Verification fails closed, so private islands stay unavailable (the remote answers `503`) until it recovers.

See [Identity](../guides/identity.md).
