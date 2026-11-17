# NF-026: Unsupported `@module-federation/vite` version

## What happened

The `@module-federation/vite` that `@next-federation/vite` resolved is not the version it supports.

## Why

`nextFederationComponents` (remote components) relies on how `@module-federation/vite` builds the
server copy of a remote: the CommonJS `remoteEntry.ssr.js` it emits next to the browser build, the
`ssrRemoteEntry` it writes into `mf-manifest.json`, and the share-cache code in that entry. None of
this is a documented option, so the plugin is pinned to exactly one version: **1.24.0**.

## How to fix

Remove any override or resolution that replaces `@module-federation/vite`, and let
`@next-federation/vite` install its own pinned copy. A CI canary job testing a newer version can
set `NF_ALLOW_MF_VITE=1` to log this as a warning instead of failing; do not use it for releases.
