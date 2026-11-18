# Documentation

Guides and reference for `next-federation`. New here? Read the [project README](../README.md) for
what it is, then pick a getting-started guide. [Architecture](architecture.md) explains how the
pieces fit together. The [live demo](live-demo.md) runs the examples: three hosts and two remotes,
with what each one embeds or serves and what to try.

## Getting started

Set up a host. Each guide ends with a working page that embeds a remote.

- [Next.js App Router](guides/getting-started-app-router.md): `RemoteIsland` in Server Components.
- [Next.js Pages Router](guides/getting-started-pages-router.md): `getIslandProps` and `RemoteIsland`
  in pages.
- [Client-side React (SPA)](guides/getting-started-spa.md): a Vite app with no server.

## Remotes

Build the app that provides the UI.

- [Writing an island remote](guides/writing-an-island-remote.md): a Vite app that serves
  server-rendered islands.
- [Remote components](guides/remote-components.md): expose client components that run in the host's
  React tree, with server rendering for verified builds.
- [Sharing components from a Next.js app](guides/sharing-components-from-a-next-app.md): add an
  island build next to an existing Next.js app.

## Features

- [Identity](guides/identity.md): private islands, signing keys and key rotation.
- [Server Actions in islands](guides/server-actions.md): `'use server'` functions that run on the
  remote.
- [Caching](guides/caching.md): islands with static pages, ISR and `cacheComponents`.
- [Content Security Policy](guides/csp.md): the directives a host needs for remote origins.
- [Migrating from nextjs-mf](guides/migrating-from-nextjs-mf.md): a concept map and a Pages Router
  path for apps that use `@module-federation/nextjs-mf`.

## Operations

- [Deployment](guides/deployment.md): serving remotes, compression and CORS.
- [Self-hosted skew](guides/self-hosted-skew.md): build retention so open tabs keep working after a
  deploy.
- [Deploying an island remote on Vercel](guides/deploying-a-remote-on-vercel.md): production domains
  and skew behavior on Vercel.

## Reference

- [Architecture](architecture.md): how islands and remote components work and what a host trusts.
- [Limits](guides/limits.md): what islands and remote components cannot do, and what they cost.
- [Island protocol v1](protocol/v1.md): the wire contract between a host and a remote.
- Package READMEs: [sdk](../packages/sdk), [protocol](../packages/protocol),
  [core](../packages/core), [react](../packages/react), [server](../packages/server),
  [island](../packages/island), [vite](../packages/vite), [next](../packages/next).
- [Examples](../examples/README.md): runnable remotes and hosts.

## Errors

Every error message carries a code (`NF-001` and up) and links to a page that says what happened,
why, and how to fix it.

- [NF-001](errors/unknown-remote.md): Unknown remote
- [NF-002](errors/invalid-config.md): Invalid federation configuration
- [NF-003](errors/unsupported-protocol-version.md): Unsupported island protocol version
- [NF-004](errors/invalid-envelope.md): Invalid island envelope
- [NF-005](errors/envelope-url-not-allowed.md): Envelope URL is outside the remote's origins
- [NF-006](errors/react-mode-mismatch.md): Island server and client bundle run different React modes
- [NF-007](errors/island-fetch-failed.md): Island fetch failed
- [NF-008](errors/island-fetch-timeout.md): Island fetch timed out
- [NF-009](errors/props-not-json.md): Island props are not plain JSON
- [NF-010](errors/build-mismatch.md): Envelope was rendered by a different build than this bootstrap
- [NF-011](errors/bootstrap-load-failed.md): Island bootstrap failed to load
- [NF-012](errors/island-runtime-error.md): Uncaught error inside an island
- [NF-013](errors/identity-not-configured.md): Private island used without identity configuration
- [NF-014](errors/invalid-token.md): Identity token rejected
- [NF-015](errors/jwks-unavailable.md): Issuer JWKS could not be fetched
- [NF-016](errors/issuer-not-allowed.md): Token issuer is not in the remote's issuer map
- [NF-017](errors/next-config-wrapper-missing.md): `withNextFederation` is missing from next.config
- [NF-018](errors/island-html-stripped.md): Island rendered a script or hoistable element
- [NF-019](errors/server-actions-unsupported.md): This remote build does not support island Server Actions
- [NF-020](errors/relative-base.md): Remote `base` must be an absolute URL
- [NF-021](errors/unknown-island.md): Unknown island
- [NF-022](errors/origin-not-allowed.md): Request origin is not an allowed host
- [NF-023](errors/build-retired.md): Remote build has been retired
- [NF-024](errors/envelope-too-large.md): Island envelope exceeds the size warning threshold
- [NF-025](errors/unsupported-plugin-rsc.md): Unsupported `@vitejs/plugin-rsc` version
- [NF-026](errors/unsupported-module-federation-vite.md): Unsupported `@module-federation/vite` version
- [NF-027](errors/component-integrity-failed.md): Remote component server code failed its integrity check
- [NF-028](errors/component-browser-only.md): Remote component rendered in the browser only
- [NF-029](errors/component-load-failed.md): Remote component failed to load
- [NF-030](errors/component-require-refused.md): Remote component server code required a module the host does not provide
- [NF-031](errors/action-not-found.md): Server Action not found
- [NF-032](errors/action-request-invalid.md): Server Action request is invalid
- [NF-033](errors/action-failed.md): Server Action threw an error
- [NF-034](errors/server-action-imported-by-client.md): A client module imports a 'use server' file
- [NF-035](errors/raw-form-action.md): Island form uses a raw `action` instead of `<Form>`
- [NF-036](errors/component-shared-unavailable.md): Host does not provide a shared module version the remote component accepts
- [NF-037](errors/dev-debug-info.md): Under `next dev`, private island values may reach the browser
- [NF-038](errors/action-request-failed.md): Server Action request failed
- [NF-039](errors/component-deferred.md): Remote component deferred to request time
- [NF-040](errors/component-render-failed.md): Remote component threw while rendering

## For contributors

- [CONTRIBUTING.md](../CONTRIBUTING.md): setup and the pull request process.
- [AGENTS.md](../AGENTS.md): repo map, commands and the rules every change keeps.
- [Code conventions](conventions.md) and [Releasing](releasing.md).
- [Maintainer notes](maintainers/mf-vite-init-keys.md): checks to run when bumping
  `@module-federation/vite`.
- [Live demo setup](maintainers/live-demo.md): the examples' Vercel projects, environment variables
  and deploy order. The public page is [Live demo](live-demo.md).
