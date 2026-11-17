# NF-028: Remote component rendered in the browser only

## What happened

The host did not render a remote component on the server. It rendered the component's fallback in
the server HTML and the browser rendered the component itself. The component still works; the page
just has no server HTML for it. The message names the case:

- **Unverified build**: the build is neither signed by a key in `components.ssr.publicKeys` nor
  pinned in `components.ssr.pinned` (and `integrity: 'unsafe-dev'` is not set in development).
- **Untrusted descriptor**: the descriptor passed to the component was not verified in this server
  process, or no longer fits the remote's current policy (origin, container name, or
  `ssr.maxAge` for a signed build). Pass the value of `getComponentDescriptor`, never a hand-made
  or request-supplied descriptor.
- **Node.js too old**: server rendering needs `process.getBuiltinModule` (Node.js 20.16 or newer).
- **Nested remotes, or no checkable manifest**: the build's `mf-manifest.json` lists `remotes` of
  its own, lists no `remotes` array, or the descriptor's `manifest` is not a manifest the server
  loader could check (for example the remote entry itself). Its nested code would load outside the
  sha384 check, so it never server-renders, in any host.
- **Build that cannot be kept apart per router layer**: in a host with App Router and Pages Router
  routes (two Reacts in one process), builds made with a Module Federation plugin version the server
  loader does not know how to isolate server-render in one layer per process only. The other layer
  renders them in the browser.
- **Another React or a stale module in the share cache**: this runtime's Module Federation share
  cache holds another React, or another instance of a host-provided module (two copies installed,
  one registered twice, a fallback copy cached before the host registered its own, or a dev server
  such as `next dev --webpack` reloaded the host's modules).

Each case is logged once per build (and router layer), or once per process.

A static regeneration that runs before the server process has loaded the build is not this code:
the components still render on the server, at request time. See
[NF-039](component-deferred.md).

## How to fix

- Sign the remote's descriptor (`NF_COMPONENTS_SIGNING_KEY` at build time, `publicKeys` in the
  host) or pin its builds. See `docs/guides/remote-components.md`.
- Pass the descriptor from `getComponentDescriptor` unchanged.
- Run the host on Node.js 20.16 or newer.
- Nested remotes: expose the nested components from their own remote and use them from the host
  directly.
- Mixed App Router and Pages Router hosts: build remotes with a Module Federation plugin version the
  library lists (see "Mixed-router hosts" in `docs/guides/remote-components.md`).
- Stale share cache in development: restart the dev server. In production, install one copy of
  each host-provided module and register it once.
- `components.ssr: false` turns server rendering off for a remote without a warning.
