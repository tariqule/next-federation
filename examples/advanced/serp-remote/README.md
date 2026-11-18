# example-serp-remote

**Remote** (island remote, Vite, remote name `serp`). SERP (search results page): serves
`SearchResults` to the [storefront](../storefront/README.md). It has no UI of its own.

`SearchResults` takes `{ q, locale }` and renders the matching products, with a client component
that sorts them (`SortableResults`). The storefront's search page reads `?q=` per request, inside
`<Suspense>`, so the results stream into the page's static shell; the island's envelope is still
cached, one entry per query, because the props are part of the cache key. The search box itself is
a remote component of the [Header remote](../header-remote-rspack/README.md).

## Run it

Part of the [commerce platform](../README.md) (`pnpm examples:platform`). Alone:
`pnpm --filter example-serp-remote dev`, or `build` then `start` (nf-serve on 127.0.0.1:13402).
Check it: <http://127.0.0.1:13402/_nf/health>. Then search for "camp" in the storefront's header
and turn on **How is this page built?**: `SearchResults` is marked as streamed.

Guides: [Writing an island remote](../../../docs/guides/writing-an-island-remote.md),
[Caching](../../../docs/guides/caching.md).
