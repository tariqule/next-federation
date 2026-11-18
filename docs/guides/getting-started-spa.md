# Getting started: client-side React host (Vite SPA)

Runnable example: [examples/react-spa](../../examples/react-spa)

A single-page app has no server to fetch envelopes, so the browser fetches them (CORS) and mounts
them with `IslandMount`. Per-user islands need a server to mint tokens and are not covered here.

Supported: React 19 (required: `IslandMount` uses React 19 APIs). This guide builds the SPA with
Vite; the library packages target Node.js 20.9 or newer.

## Choosing between remote components and islands

This guide sets up islands. A remote can also ship remote components, and a host can use both.

| | Remote components | Islands |
| --- | --- | --- |
| What the remote ships | A client component module | HTML rendered on the remote's server |
| React | The host's | The remote's own (or the host's, with `provideHostReact`) |
| Host context | Readable | Does not cross in; pass data as props |
| Props | Anything a client component takes | Plain JSON |
| Rendering in an SPA | In the browser | The remote's HTML, then hydration |
| `next/link` and other Next modules | Not available in an SPA (`NF-036`) | Not used; `Link` from `@next-federation/island` |
| Choose it for | Interactive pieces that share the app's state | Content the remote renders and fetches itself |

Remote components: see [Remote components](remote-components.md).

## 1. Install

```sh
pnpm add @next-federation/core @next-federation/react react react-dom
```

## 2. Define the remotes

```ts
// src/lib/islands.ts
import { defineFederation, fetchIsland } from '@next-federation/core'
import type { IslandResult, IslandTarget } from '@next-federation/core'

export const federation = defineFederation({
  remotes: { shop: { origin: 'https://shop.example.com' } },
})

export function loadIsland(target: IslandTarget, island: string, props?: unknown): Promise<IslandResult> {
  return fetchIsland(target, { island, props, init: { cache: 'no-store' } })
}
```

The remote must list your app's origin in its `hosts` option, or the browser request is refused
(`NF-022`).

### Timeout and retries

`timeoutMs` and `retries` work as in the App Router host
([Timeout and retries](getting-started-app-router.md#timeout-and-retries)). When the budget runs
out, `fetchIsland` resolves with `{ ok: false, code }` (`NF-007`, `NF-008`) instead of throwing, and
your page renders its fallback.

## 3. Mount an island

```tsx
// src/Shop.tsx
import type { IslandEnvelope } from '@next-federation/protocol'
import { IslandMount } from '@next-federation/react'
import { useEffect, useState } from 'react'
import { federation, loadIsland } from './lib/islands'

export function Shop() {
  const [envelope, setEnvelope] = useState<IslandEnvelope>()
  useEffect(() => {
    void loadIsland(federation.target('shop'), 'ProductPanel', { sku: 'A1' }).then(
      (result) => result.ok && setEnvelope(result.envelope)
    )
  }, [])
  return envelope ? <IslandMount envelope={envelope} /> : <p>loading…</p>
}
```

`fetchIsland` returns `{ ok: true, envelope, meta }` or `{ ok: false, code, status?, meta }`. Handle
the failure case by rendering your own fallback. Wrap islands in `FederationErrorBoundary` to catch
render errors.

## 4. Share the host's React (optional)

```tsx
// src/main.tsx, at module scope before the first island loads
import { provideHostReact } from '@next-federation/react/share'

provideHostReact()
```

Islands built on the host's exact React version then use the host's copy. It does nothing in
development or on a pre-release React.

## What to know

- A SPA has no server-side render of the island: the island's HTML shows once the envelope arrives.
- `IslandMount` loads the island's stylesheets itself (one `<link>` per href in `<head>`); you add
  no `<link>` for them.
- Add each remote origin to `script-src`, `connect-src` and `style-src` ([CSP](csp.md)).
- Props are plain JSON; React context does not cross into an island ([Limits](limits.md)).
- Remote components (client components): see [Remote components](remote-components.md).
