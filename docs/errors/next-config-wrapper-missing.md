# NF-017: `withNextFederation` is missing from next.config

## What happened

next-federation code ran in an app whose `next.config` does not use `withNextFederation`.

## Why

The wrapper sets `env.NF_CACHE_MODEL`, `env.NF_BASE_PATH` and `env.NF_NEXT_VERSION`, aliases the island cache for your caching model, and adds `@next-federation/next` to `transpilePackages`. The runtime reads these values; without them it cannot tell which cache model or `basePath` the app uses.

## How to fix

Wrap your config: `export default withNextFederation(nextConfig)` (imported from `@next-federation/next/config`) and restart the build. See [Getting started: App Router](../guides/getting-started-app-router.md#2-wrap-nextconfigts).
