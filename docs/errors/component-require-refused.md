# NF-030: Remote component server code required a module the host does not provide

## What happened

While evaluating a remote build's server code, the code called `require()` for a module the host
does not hand out. The host's loader resolves only the remote's own relative files and
`@module-federation/runtime`; everything else is refused, and the component renders in the browser
only.

## Why

Mode A components run on the host's React. A remote that bundles or requires its own copy of
React (or any package the host should provide) would run a second React in the host process and
fail with "Invalid hook call", or pick up arbitrary packages from the host's `node_modules`.

This is **not a sandbox**. Remote server code that passed the integrity check runs with the host
process's full authority: `process`, `globalThis` and dynamic `import()` are reachable from it. The
allow-list only keeps a remote from silently loading a second React or arbitrary host packages; the
integrity check (signed or pinned builds, `NF-027`) is the security boundary.

## How to fix

Build the remote with `nextFederationComponents`: React, `react-dom` and `react/jsx-runtime` are
host-provided. List every other package the host owns (a context module, a design system) in the
remote's `shared` option and in the host's `createRemoteComponent({ shared })`. Packages the remote
uses only itself are bundled into its chunks and never required.
