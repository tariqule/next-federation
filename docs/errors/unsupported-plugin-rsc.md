# NF-025: Unsupported `@vitejs/plugin-rsc` version

## What happened

The `@vitejs/plugin-rsc` that `@next-federation/vite` resolved is not the version it supports.

## Why

`@vitejs/plugin-rsc` is still 0.x. The Vite adapter depends on its internals (how it patches the
flight client, how `loadCss` is wired), which can change in any release, so it is pinned to exactly
one version: **0.5.39**.

## How to fix

Remove any override or resolution that replaces `@vitejs/plugin-rsc`, and let
`@next-federation/vite` install its own pinned copy. A CI canary job testing a newer plugin-rsc can
set `NF_ALLOW_PLUGIN_RSC=1` to log this as a warning instead of failing; do not use it for
releases.

See [Writing an island remote](../guides/writing-an-island-remote.md).
