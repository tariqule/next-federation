# NF-013: Private island used without identity configuration

## What happened

A private island was requested but no identity settings are configured.

## Why

Private islands need to verify who is asking. Without an issuer and key source the remote cannot authenticate the call, so it refuses.

## How to fix

Configure identity on both host and remote (issuer map and token provider), or mark the island public if it should not require authentication.
