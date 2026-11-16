# NF-005: Envelope URL is outside the remote's origins

## What happened

An envelope referenced an asset or bootstrap URL on an origin the remote does not own.

## Why

Envelope URLs are checked against the remote's declared origins so a compromised or misbehaving remote cannot make the host load code from elsewhere.

## How to fix

Add the origin to the remote's `assetOrigins` list in `defineFederation` if it is legitimate (for example a CDN). The remote's own `origin` is always allowed. Otherwise investigate why the remote emitted it.
