# NF-002: Invalid federation configuration

## What happened

The object passed to `defineFederation()` or `withNextFederation()`, or an option of an island component, failed validation.

## Why

A required field is missing, has the wrong type, or two fields contradict each other. The error detail names the offending path.

A common case: a URL (remote origin, asset origin, `base`, issuer or JWKS URL) uses plain `http` for a host other than `localhost`, `127.0.0.0/8` or `[::1]` outside development. Plain `http` is accepted only when `NODE_ENV` is `development` or `test`, or with `allowInsecureHttp: true`.

Another: `withNextFederation()` got `cacheComponents` (or Next 15's `experimental.cacheComponents` or `experimental.dynamicIO`) with Next.js 15 installed. next-federation supports `cacheComponents` on Next.js 16 only; on Next.js 15 it uses the legacy caching model (fetch `revalidate` and tags).

Another: an App Router `RemoteIsland` got `blocking` without `private`. `blocking` renders a private island in the first HTML instead of streaming it; a public island is cached and already renders in place.

Another: `nextFederationIslands` (an island remote) cannot find `react-server-dom-webpack`. It is an optional peer dependency of `@next-federation/vite`, since components remotes never use it, so npm does not install it for you. The message names the install command for your React version.

A warning, not an error: a components remote's dev server (`nextFederationComponents`) logs `NF-002` once when a browser opens a page of the Vite project. That project's React and `shared` modules are host-provided, so the page cannot run on its own.

## How to fix

Fix the field named in the message. For `cacheComponents` on Next.js 15, remove the option or upgrade to Next.js 16. For `blocking`, remove it from the public island or add `private`. For `react-server-dom-webpack`, install it at exactly your React's version (`npm install --save-exact react-server-dom-webpack@<react version>`). For the components dev-page warning, keep the standalone app in its own Vite config ([Keeping a standalone app](../guides/remote-components.md#keeping-a-standalone-app)). For a plain-`http` URL, switch it to `https`; set `allowInsecureHttp: true` only when the traffic is protected some other way (it logs a warning once per process). Configuration is validated at startup so a bad value never reaches production traffic.
