# Caching

Runnable example: [examples/advanced/storefront](../../examples/advanced/storefront), an App Router
host with `cacheComponents`: static shells with public islands, streamed and `blocking` private
islands, per-island `revalidate`, and a "Publish" route that calls `revalidateIsland`.

How islands are cached depends on the host. Public islands are cached; private islands never are.

## App Router, legacy mode (no `cacheComponents`)

The adapter fetches the envelope with Next's fetch cache: `next: { revalidate, tags }`. `revalidate`
defaults to `islands.revalidate` (60 seconds). The tags are `nf:<remote>` and `nf:<remote>:<island>`.

- The page can be static (ISR). When a regeneration's island fetch fails, the page keeps the island's
  **last good envelope** (stale-if-error, see below) and the next regeneration, `revalidate` seconds
  later, tries again. Without a last good envelope, the fallback is in that page until the next
  regeneration: at most `revalidate` seconds.
- A 200 response whose body is not a valid envelope (`NF-004`) is cached for `revalidate` seconds as
  well. Non-2xx responses, timeouts and network errors are not cached.
- `dynamic` fetches on every request (`cache: 'no-store'`) and makes the route dynamic.

## App Router, `cacheComponents`

The envelope comes from a `'use cache'` function, with the same tags.

- A failure never turns a static page into a partial prerender. A failed fetch is cached with a
  short inline profile, `{ stale: 30, revalidate: 5, expire: 600 }`: it stays in the static shell, so
  the page stays static (`○`, with `x-nextjs-cache`) and is regenerated within about 5 seconds. The
  island shows its last good envelope (stale-if-error) or, without one, its `errorFallback`. A
  working island stays cached for its `revalidate`.
- Why not a dynamic hole: Next 16 leaves a cache entry whose `expire` is under 5 minutes out of a
  static prerender. When that entry was the page's only changing content, the regenerated shell gets
  `revalidate: false`, so Next never regenerates it again: the page is served `private, no-store`
  with the island rendered per request, also after the remote recovers and across restarts (Next
  keeps it in `.next/server/route-cache`), and its client navigations (RSC requests) answer 404
  after a restart. A Next 16.4 app without next-federation does the same with a short `cacheLife`
  inside `<Suspense>`.
- `RemoteIsland` renders its own `<Suspense>` (a private island with `blocking` does not, see
  [Private islands](#private-islands)).
- If you put your own `'use cache'` component around a `RemoteIsland`, a failed island (or one
  showing its last good envelope) applies the same failure profile to that component's entry
  (`cacheLife()` keeps the shortest call in a scope, even against an explicit long one there), so the
  failure is retried within seconds instead of being kept for the component's lifetime. Keep such a
  component inside `<Suspense>`: anything uncached in it (a private island, for example) needs one.

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

## Stale-if-error

A cached public island whose fetch fails (`NF-003`, `NF-004`, `NF-005`, `NF-007`, `NF-008`) renders the
last good envelope this server process fetched for the same remote, island, props and host context,
instead of the fallback. It is kept as long as the island's cache entry could be served stale: at
least an hour, or twice `revalidate`. The failure is still logged with its code ("…failed (HTTP 503);
rendering its last good envelope (42 s old)") and emitted as `island:error`, and the island is
retried soon (above). The envelope's build stays loadable because remotes retain builds
([Build cache and remote retention](#build-cache-and-remote-retention)).

The last good envelopes live in the server process's memory (at most 500, 50 MiB in all, keys and props included). A fresh
process, a new serverless instance, or `next build` has none, so a failure there renders the
fallback. Private and `dynamic` islands are never served stale, nor is an island whose remote
answers `404` with a JSON body (`Content-Type: application/json`, logged as `NF-007`). Any JSON 404
counts as a deliberate removal, so the fallback renders at once: the remote's own
`{"error":"NF-021"}` for an island it no longer exposes, but also, say, an API gateway's
`{"message":"Not Found"}` in front of it. A 404 with any other content type, such as an HTML page
from a proxy or a CDN, may be an outage and is still served stale.

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

`getIslandProps` fetches on every call. In `getStaticProps`, the page's own `revalidate` is the cache.
When the fetch fails, `getIslandProps` returns the island's last good envelope with `stale: true`
(stale-if-error, above), or `envelope: null` without one. Either way, regenerate soon:

```ts
return { props: { banner }, revalidate: banner.envelope && !banner.stale ? 60 : 5 }
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
