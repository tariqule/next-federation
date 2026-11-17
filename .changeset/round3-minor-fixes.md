---
'@next-federation/server': minor
'@next-federation/core': minor
'@next-federation/react': patch
'@next-federation/next': patch
---

Fixes from the third validation round (medium and low findings).

- `nf-serve` compresses what it serves. JavaScript, CSS, JSON, SVG, HTML, source maps and text files of at least 1 KB, components descriptors and public JSON island envelopes are sent brotli- or gzip-encoded per `Accept-Encoding` (q-values, `identity` and `*;q=0` honoured), with `Vary: Accept-Encoding`; `Cache-Control`, CORS and the rest of the headers are unchanged, and a build's strong `ETag` becomes weak once encoded. Compressed files are cached in memory per path, modification time and size (new option `compressionCacheBytes`, default 64 MiB). Range and `HEAD` requests, images and fonts, bodies a build encoded itself, Server Action results and envelopes of requests that carried an identity token are sent as they are. Uses `node:zlib` only.
- The `NF-007` and `NF-008` log lines name the island URL (origin and path, never the query or the token) and the HTTP status. When the origin answers an HTML page or a non-protocol `404`, `NF-007` adds a hint that the origin is probably not an island remote (a Next.js app cannot be one); `NF-029` adds the same hint for a components descriptor that answers `404` or HTML. A failed `fetchIsland` result carries `url` and `hint`, and `islandFailureDetail(result)` formats them.
- A remote components build whose Module Federation manifest lists `remotes` of its own (or has no remotes list, or no JSON manifest) is refused when its descriptor is fetched: `fetchVerifiedComponentDescriptor` returns it browser-only with `NF-028`. Such a build no longer logs a misleading `NF-039` first, and the server loader is never asked to load it. When the server loader refuses a build itself, it does so before the Module Federation runtime runs, so the runtime no longer logs `Failed to get manifest #RUNTIME-003` with a stack trace, and the refusal is recorded at once for the static-regeneration check.
