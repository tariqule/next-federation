# Caching

How islands are cached depends on the host. Public islands are cached; private islands never are.

## App Router, legacy mode (no `cacheComponents`)

The adapter fetches the envelope with Next's fetch cache: `next: { revalidate, tags }`. `revalidate`
defaults to `islands.revalidate` (60 seconds). The tags are `nf:<remote>` and `nf:<remote>:<island>`.

- The page can be static (ISR). **A remote that is down when the page is generated is baked into
  that page** as the fallback, until the next regeneration. That is at most `revalidate` seconds.
- A 200 response whose body is not a valid envelope (`NF-004`) is cached for `revalidate` seconds as
  well. Non-2xx responses, timeouts and network errors are not cached.
- `dynamic` fetches on every request (`cache: 'no-store'`) and makes the route dynamic.

## App Router, `cacheComponents`

The envelope comes from a `'use cache'` function, with the same tags.

- A **failure is never frozen**. It switches the entry to a short cache lifetime (Next's `seconds`
  values), so a failed island becomes a dynamic hole inside its `<Suspense>` boundary (the route
  shows as `◐`) and is retried within about a second. A working island stays cached.
- `RemoteIsland` renders its own `<Suspense>` (a private island with `blocking` does not, see
  [Private islands](#private-islands)).
- If you put your own `'use cache'` component around a `RemoteIsland`, that component **must be inside
  `<Suspense>`**. A failed island also shortens the enclosing cache, so the failure is not kept for
  the scope's lifetime. If the component is not inside `<Suspense>`, a build with the remote down
  fails with Next's "uncached data outside `<Suspense>`" error.

```tsx
async function CachedSection() {
  'use cache'
  cacheLife('hours')
  return <RemoteIsland remote="shop" island="Banner" fallback={<p>loading…</p>} />
}

export default function Page() {
  return (
    <Suspense fallback={<p>loading section…</p>}>
      <CachedSection />
    </Suspense>
  )
}
```

## Private islands

Private islands are never cached. Without `cacheComponents`, a private island makes the route
dynamic. With it, the island is a dynamic hole. The token never enters a cache key, the HTML or the
RSC payload ([Identity](identity.md)).

### `blocking`: the island in the first HTML

`<RemoteIsland private blocking … />` renders without the island's own `<Suspense>`, so its HTML is
in the first flush, in place, with no streamed `fallback` and no swap
([Getting started](getting-started-app-router.md#private-content-in-the-first-html-blocking)). The
caching consequences:

| Host | Route config | `next build` marker | First byte |
| --- | --- | --- | --- |
| No `cacheComponents` (Next 16 or 15) | none (`instant` is refused) | `ƒ` (already dynamic) | after the island loads or fails |
| `cacheComponents` | `export const instant = false` in the page | `ƒ`, not `◐` | after the island loads or fails |

- The whole route becomes per-request. With `cacheComponents` it loses its static shell: every
  layout above the island, the rest of the page and its public islands render on each request
  (`ƒ` instead of `◐`). Keep `blocking` off pages that should be served from a static shell.
  `instant = false` does not make a route dynamic by itself; the island's `cookies()` read outside
  `<Suspense>` does, and `instant = false` is how the route accepts it. Without
  `instant = false`, `next build` fails with Next's "Next.js encountered uncached or runtime data
  during prerendering" error, so the change is never silent. The same build error appears when an
  ancestor layout sets `instant = true`: Next skips the static-shell check only when the highest
  `instant` in the tree is `false`.
- Without `cacheComponents`, `next build` refuses `instant` (Turbopack: "Route segment config
  "instant" requires `nextConfig.cacheComponents` to be enabled"; webpack: "Route "/x" cannot use
  `export const instant = ...` without enabling `cacheComponents`").
- The response waits for the remote, up to the island timeout (`timeoutMs`, 3 seconds by default).
  A remote that fails or times out renders `errorFallback` in place and the page answers `200`.
  That covers remote failures only: if the host's own `getIdentity` or token minting throws, the
  error reaches the route's `error.tsx` (no `200`), where without `blocking` the island would be
  rendered in the browser under its own `<Suspense>`. Return `null` from `getIdentity` instead of
  throwing.
- Public islands on the same page are still cached (their envelopes), but they render within the
  per-request page. `blocking` on a public island throws `NF-002`.

## Pages Router

`getIslandProps` fetches on every call. In `getStaticProps`, the page's own `revalidate` is the cache,
so a remote failure is kept for that window. Retry sooner when the envelope is missing:

```ts
return { props: { banner }, revalidate: banner.envelope ? 60 : 1 }
```

Private islands work in `getServerSideProps` only.

## Refreshing on demand

`revalidateIsland(remote, island?)` expires `nf:<remote>` or `nf:<remote>:<island>` immediately. Call it
from a webhook your remote's deploy pipeline triggers. It is an App Router function.

## Events for cached islands

`island:fetch` and `island:error` events (the `onEvent` option of `defineFederation`) describe the
fetch that produced the envelope. A page served from cache does not emit new events, except that
legacy mode can run the request code on a data-cache hit and emit it with its own short duration.
Do not use event counts as page-view counts.

## Build cache and remote retention

A cached envelope pins a remote **build**: its assets live at `/b/<buildId>/…`. Your host's cache
(the Next build cache, ISR pages, a CDN) must not outlive the remote's build retention. If it does,
the page refers to a retired build, the remote answers `410` with `NF-023`, and the island stays
inert (its server HTML shows, but it never hydrates). `nf-serve` keeps the newest 3 builds or any
younger than 24 hours. Keep the remote's retention at least as long as your longest host cache
lifetime. See [Deployment](deployment.md) and [NF-023](../errors/build-retired.md).
