# NF-007: Island fetch failed

## What happened

The host could not fetch an island from its remote. The island renders its fallback; the page still
answers.

The log line names the island, the remote, the island URL and, for an HTTP error, the status:

```text
NF-007: Island fetch failed. Island "Hello" from remote "shop" failed at https://shop.example.com/_nf/island/Hello (HTTP 503); rendering its fallback.
```

The URL is the origin and path only. The query (the island's props and host context) is never
logged, and neither is the identity token.

When the origin answered an HTML page, or a `404` that is not the protocol's JSON error, the line
adds a hint:

```text
... failed at https://app.example.com/_nf/island/Hello (HTTP 404); the origin answered HTML / 404: is it an island remote (does it serve /_nf/island)? A Next.js app can't be a remote (see .../sharing-components-from-a-next-app.md); rendering its fallback.
```

## Why

- The request failed with a network error or a non-success status: the remote may be down,
  unreachable from the host, or returning an error. `502`, `503` and `504` and network errors are
  retried once by default (`retries`, per remote or `islands.retries`) within the timeout; other
  statuses are not.
- The remote redirected. Redirects are refused, so they count as a failed fetch.
- A response body larger than the remote's `maxBytes` (`islands.maxBytes`, 5 MiB by default). The
  host stops reading it and does not retry.
- **The origin is not an island remote** (the hint above): the remote's `origin` points at a
  website, a static host or a Next.js app, which answers `/_nf/island/<name>` with its own 404 page.
  A Next.js app cannot serve islands; its components can be shared another way
  ([Sharing components from a Next.js app](../guides/sharing-components-from-a-next-app.md)).
- An island remote that does not expose this island answers `404` with `{"error":"NF-021"}`: that
  is a wrong island name, not a wrong origin, and gets no hint ([NF-021](unknown-island.md)). The
  host's log line shows NF-007 with `(HTTP 404)`; NF-021 is in the remote's response. It is
  never served from the last good envelope below: the remote removed the island on purpose.

A cached public island keeps rendering its last good envelope from this server process while its
remote fails (the log line then ends "rendering its last good envelope (N s old)"); otherwise the
island's `errorFallback` renders. The page stays static either way and retries soon
([Caching](../guides/caching.md#stale-if-error)).

## How to fix

Open the logged URL from the host's network. Check that the remote is running and reachable, that
the remote's `origin` in `defineFederation` is the island remote (built with
`@next-federation/vite`, served by `nf-serve` or a server running `createIslandHandler`), and that
the island name is one the remote exposes. The original error is attached as `cause` when there is
one.
