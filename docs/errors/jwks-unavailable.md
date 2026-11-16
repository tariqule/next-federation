# NF-015: Issuer JWKS could not be fetched

## What happened

The remote could not download the issuer's JSON Web Key Set.

## Why

The JWKS endpoint was unreachable or returned an invalid document, so tokens cannot be verified.

## How to fix

Check the issuer's JWKS URL from the remote's network. Verification fails closed, so private islands stay unavailable until it recovers.
