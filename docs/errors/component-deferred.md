# NF-039: Remote component deferred to request time

## What happened

An App Router page with `cacheComponents` was regenerated (after `next start`) before this server
process had loaded the remote components' build. Next ends a static prerender before a build loads,
so rendering the components then would keep their fallback in the static page for a whole
revalidate window. Instead, that one render leaves the remote components out of the static shell:
they render per request, on the server, and each request waits for the build.

The visitor still gets server-rendered markup for the components. Until the next regeneration the
page is a partial prerender: its static shell is served with `x-nextjs-postponed: 1` and
`Cache-Control: private, no-cache, no-store`, and the components stream in per request. The shell
keeps the page's other cached data (the components descriptor at least), so Next regenerates it on
the descriptor's revalidate time (`components.revalidate`, 60 s by default). That regeneration,
once the build has loaded (or was refused), puts the components back in the static page, which is
served from the cache again (`x-nextjs-cache`). Next may also log `Unexpected cache miss after cache
warming phase` for that one regeneration; it does not change the outcome.

It is logged once per build, as a warning.

## Why

The server loader fetches, checks (sha384) and evaluates a build on first use. A freshly started
process, or one that just saw a new build of the remote, has not done that yet when the first
regeneration runs. `next build` and `next dev` never defer: the build waits for every component,
and `next dev` renders per request anyway.

## How to fix

Nothing to fix; it resolves by itself once the process has loaded the build. If the remote
components should not render on the server at all, set `components.ssr: false` for that remote.
A component that renders in the browser only (no server markup) is
[NF-028](component-browser-only.md).
