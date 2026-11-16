# NF-028: Remote component rendered in the browser only

## What happened

The host rendered a remote component's fallback on the server and the browser rendered
the component itself. It still works; the page just has no server HTML for it. The message says
which case applies:

- **Unverified build**: the build is neither signed by a key in `components.ssr.publicKeys` nor
  pinned in `components.ssr.pinned` (and `integrity: 'unsafe-dev'` is not set).
- **Node.js too old**: server rendering needs `process.getBuiltinModule`, Node.js 20.16 or newer.
- **Two Reacts in one process**: `@module-federation/vite` keeps a process-wide share cache in
  which the first React wins. In a host that renders App Router and Pages Router routes in one
  process (two React copies), the route whose React did not register first renders browser-only.

- **Stale share cache**: the same cache holds an older instance of a host-provided module (a dev
  server, such as `next dev --webpack`, reloaded the host's modules). Restart the dev server.

The warning is logged once per build (or once per process).

## How to fix

- Sign the remote's descriptor (`NF_COMPONENTS_SIGNING_KEY` at build time, `publicKeys` in the
  host) or pin its builds. See `docs/guides/remote-components.md`.
- Run the host on Node.js 20.16 or newer.
- Mixed App Router + Pages Router hosts are supported after v1; keep remote components to one
  router per host, or accept browser-only rendering on the other one.
- `components.ssr: false` turns server rendering off for a remote without a warning.
