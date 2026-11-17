---
'@next-federation/next': minor
---

Public islands on static pages, from validation rounds 3 and 4.

- With `cacheComponents`, an island failure no longer turns a static page into a partial prerender for good. A failed island (or components descriptor) was cached with Next's `seconds` values, which Next leaves out of a static prerender. When the island was the page's only changing content, the regenerated shell got `revalidate: false`: Next never regenerated it again, served it `private, no-store` with the island rendered per request, kept it across restarts in `.next/server/route-cache`, and answered its RSC requests (client navigations) with 404 after a restart. A failure is now cached with `{ stale: 30, revalidate: 5, expire: 600 }`: it stays in the static shell, so the page stays static and is regenerated within about 5 seconds. NF-039 still defers on purpose; that page keeps its descriptor entries and is regenerated.
- Stale-if-error: a public island whose fetch fails renders the last good envelope this server process fetched for the same remote, island, props and host context, for at least an hour or twice `revalidate`, instead of replacing it with the fallback. The failure is still logged with its code ("rendering its last good envelope (N s old)") and emitted as `island:error`. It applies with and without `cacheComponents` and to `getIslandProps`, which marks such a result `stale: true`. Private and `dynamic` islands are never served stale.
