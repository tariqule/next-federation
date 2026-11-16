# NF-010: Envelope was rendered by a different build than this bootstrap

## What happened

The envelope's build id differs from the build id of the client bootstrap that tried to hydrate it.

## Why

The remote deployed a new build between the server render and the client load, so markup and code no longer match.

## How to fix

This is usually transient: reload to pick up the new build. Keep old builds available during rollout (see NF-023) so in-flight pages keep working.
