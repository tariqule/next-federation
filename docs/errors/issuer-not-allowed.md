# NF-016: Token issuer is not in the remote's issuer map

## Why This Error Occurred

A token named an issuer the remote does not trust. The remote only accepts issuers listed in its `issuers` map.

## Possible Ways to Fix It

- Add the issuer to the remote's `issuers` if it should be trusted.
- Or fix the host so it signs with the right issuer.
- Make the token's `iss` equal a map key exactly. A trailing slash makes a different issuer.

## Useful Links

- [Identity](../guides/identity.mdx)
