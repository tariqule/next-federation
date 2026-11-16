# NF-016: Token issuer is not in the remote's issuer map

## What happened

A token named an issuer the remote does not trust.

## Why

The remote only accepts tokens from issuers listed in its issuer map.

## How to fix

Add the issuer to the remote's issuer map if it should be trusted, or fix the host so it signs with the right issuer.
