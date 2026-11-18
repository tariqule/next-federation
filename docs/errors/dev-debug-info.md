# NF-037: Under `next dev`, private island values may reach the browser

## What happened

Under `next dev`, React sends the values that Server Components await to the browser as
development debug info. Next.js 15 inlines it in the App Router's HTML and RSC payload; Next.js 16
sends it over the dev server's HMR websocket. Next's dev tooling leaves code it recognises as a
dependency out of it. The host logged this warning (once per process, per cause) because that
recognition fails or may fail for `@next-federation/next`, so the debug info may carry what it
awaits for a private island:

- the request's cookies (HttpOnly ones included) and headers (`Authorization` too),
- what your `getIdentity` returns,
- the island token minted for the remote.

Production builds never contain it.

## Why

The message names the cause:

- **Linked library**: `@next-federation/next` runs from outside `node_modules` (a workspace
  package, `npm link`, a source checkout). Next treats it as your own code, and the values above do
  reach the browser.
- **Source maps disabled**: `next dev --disable-source-maps` turns off Node's source maps, which
  Next uses to recognise dependencies. With Turbopack and webpack on Next.js 15.5.28 and 16.4.6 we saw no values
  reach the browser, but nothing guarantees it, so the host warns.

Installed from npm with Next's default dev source maps, the library is left out of the debug info.
See [Limits](../guides/limits.md#next-dev-and-linked-installs).

## How to fix

Nothing is broken; this only affects `next dev`.

- Keep the dev server on your machine: `next dev -H 127.0.0.1`. By default `next dev` listens on
  every network interface (`0.0.0.0`).
- Run `next dev` with source maps (the default: drop `--disable-source-maps`).
- To check what a real install sends while you develop the library, install the packed packages
  (`pnpm pack`) instead of linking them, or run a production build (`next build && next start`).
