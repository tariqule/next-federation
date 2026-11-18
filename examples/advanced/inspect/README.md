# example-inspect

**Demo helper**, not part of next-federation. The labels the advanced example hosts put around
each embedded piece, and the **How is this page built?** layer. Leave it out of your app.

- `Embedded`: the dashed outline and tag around an island, a remote component or a host component.
  It is host markup that wraps the piece and never goes inside it. Its badge shows what the host
  knows (the remote, the cache mode the code configured, private or public, the router) and what the
  browser saw (in the first HTML, streamed, or rendered in the browser; the island's build id).
- `ARRIVALS_SCRIPT`: an inline script for the page head that watches the HTML parser, to tell the
  first HTML from streamed parts. See the comment in `src/arrivals.ts`.
- `PagePanel`: the page summary (how the route is configured, a timeline, links).
- `ActivityToasts`: Server Action results and island errors, from the islands' `nf:island` DOM
  events.

Everything is off until you press the button, and it renders nothing on the server, so it cannot
change the server HTML or hydration. No badge shows a token.

Part of the [commerce platform](../README.md).
