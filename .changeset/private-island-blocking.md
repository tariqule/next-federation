---
'@next-federation/next': minor
---

App Router `RemoteIsland` takes `blocking` for private islands: the island renders without its own `<Suspense>`, so its HTML is in the first HTML, in place, with no streamed `fallback` and no client-side swap (as the Pages Router renders it). The page's response waits for the remote, up to the island timeout; a failed, slow or invalid island renders `errorFallback` in place with the same `NF-007`, `NF-008` or `NF-004` log, and the page answers `200`. The route has no static shell (`next build` shows `ƒ`). With `cacheComponents` the page must export `instant = false`, or `next build` fails with Next's "runtime data during prerendering" error; without `cacheComponents` (Next 16 or 15) nothing else is needed. `blocking` on a public island throws `NF-002`. The token rules are unchanged: no token in the HTML or the RSC payload, private envelopes fetched with `cache: 'no-store'`.
