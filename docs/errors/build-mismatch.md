# NF-010: Envelope was rendered by a different build than this bootstrap

## Why This Error Occurred

The envelope's build id differs from the build id of the client bootstrap that tried to hydrate it. The remote deployed a new build between the server render and the client load, so markup and code no longer match.

## Possible Ways to Fix It

- This is usually transient: reload to pick up the new build.
- Keep old builds available during rollout ([NF-023](build-retired.md)) so in-flight pages keep working.

## Useful Links

- [Self-hosted build retention](../guides/self-hosted-skew.mdx)
