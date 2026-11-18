# NF-012: Uncaught error inside an island

## What happened

Code running inside an island threw an error that nothing caught.

## Why

The island's own component code failed during render or in an effect. The host stays up; only the island is affected. The island is a separate React root, so the host's error boundaries do not see the error: the mount reports it and shows `errorFallback`.

`nf-serve` logs `NF-012` too when the process of a live island build exits after startup. See [Deployment](../guides/deployment.md#self-hosted-nf-serve).

## How to fix

Fix the error in the remote. Pass `errorFallback` to the island in the host if you want a specific fallback while it is broken.

See [Limits](../guides/limits.md).
