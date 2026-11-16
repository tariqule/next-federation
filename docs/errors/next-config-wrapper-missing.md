# NF-017: `withNextFederation` is missing from next.config

## What happened

next-federation code ran in an app whose `next.config` does not use `withNextFederation`.

## Why

The wrapper installs the build-time pieces (rewrites, headers, asset prefix handling) the runtime relies on.

## How to fix

Wrap your config: `export default withNextFederation(nextConfig)` and restart the build.
