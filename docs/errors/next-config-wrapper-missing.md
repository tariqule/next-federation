# NF-017: `withNextFederation` is missing from next.config

## Why This Error Occurred

next-federation code ran in an app whose `next.config` does not use `withNextFederation`. The wrapper sets the values the runtime reads, such as the cache model and `basePath`.

## Possible Ways to Fix It

- Wrap your config and restart the build:

  ```ts
  // next.config.ts
  import { withNextFederation } from '@next-federation/next/config'

  export default withNextFederation(nextConfig)
  ```

## Useful Links

- [Getting started: App Router](../guides/getting-started-app-router.mdx#wrap-your-next-config)
