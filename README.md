# next-federation

Runtime composition of React UI from separately deployed apps, for **Next.js 16**
(App Router and Pages Router, Turbopack or webpack) and, later, **React Router**.

> **Status: Phase 1 library, feature-complete, not yet published to npm.** Both modes are
> implemented: Mode B (RSC islands) for Next.js App Router, Pages Router and client-side React hosts,
> and Mode A (client components with server rendering) for the same hosts, both with Vite remotes.
> See the [design document](docs/specs/2026-11-13-federation-lib-design.md).

**Supported:** React 19 (required), Next.js 16, Node.js 20.9 or newer (Mode A server rendering needs
Node 20.16 or newer; older Node renders Mode A in the browser only). Remotes build with Vite 8.

## Packages

| Package                                          | Purpose                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| [`@next-federation/sdk`](packages/sdk)           | Error codes (`NF-001` to `NF-030`) and the category logger.               |
| [`@next-federation/protocol`](packages/protocol) | Island protocol v1: envelope, request codec, bootstrap types.             |
| [`@next-federation/core`](packages/core)         | `defineFederation`, `fetchIsland`, identity tokens, Mode A descriptors.   |
| [`@next-federation/react`](packages/react)       | `IslandMount`, `FederationErrorBoundary`, Mode A `createRemoteComponent`. |
| [`@next-federation/server`](packages/server)     | Island request handler, identity verifier, `nf-serve`.                    |
| [`@next-federation/island`](packages/island)     | Remote-side runtime: `Link`, `getIdentity`, browser bootstrap.            |
| [`@next-federation/vite`](packages/vite)         | Vite 8 plugins that build an island remote or a components remote.        |
| [`@next-federation/next`](packages/next)         | Next.js adapter: `withNextFederation`, `RemoteIsland`, JWKS/token routes. |

`provideHostReact` (a SPA or Pages Router host lends islands its React) is
`@next-federation/react/share`; Mode A lives in `@next-federation/react/components`.

The wire contract is published at [`docs/protocol/v1.md`](docs/protocol/v1.md).

## Guides

- Host setup: [App Router](docs/guides/getting-started-app-router.md),
  [Pages Router](docs/guides/getting-started-pages-router.md),
  [client-side React (SPA)](docs/guides/getting-started-spa.md)
- Remotes: [Writing an island remote](docs/guides/writing-an-island-remote.md),
  [Client components (Mode A)](docs/guides/client-components.md),
  [Sharing components from a Next app](docs/guides/sharing-components-from-a-next-app.md)
- Operations: [Identity and key rotation](docs/guides/identity.md), [CSP](docs/guides/csp.md),
  [Caching](docs/guides/caching.md), [Deployment](docs/guides/deployment.md)
- [Limits](docs/guides/limits.md): what islands cannot do and what they cost
- [Examples](examples/README.md): a Vite island remote, a components remote and three hosts
  (App Router, Pages Router, SPA) you can run with `pnpm examples:dev`

## What it does

- **Client components (Mode A):** load interactive components from a remote app at runtime and render
  them inside your React tree, sharing context, with server rendering of verified (signed or pinned)
  builds. Built on the Module Federation 2.0 runtime.
- **RSC islands (Mode B):** remotes run **real React Server Components** on their own servers. Your app
  embeds the result as a self-contained, server-rendered, hydrated island. It supports per-user content,
  remotes on any origin, and smooth client-side navigation. Server Actions are not supported in
  islands (`NF-019`).

## Principles

- **No Next.js private internals.** Adapters use public framework APIs only, so Next upgrades don't
  break you. The predecessor, `@module-federation/nextjs-mf`, broke on Next upgrades because it relied
  on those internals.
- **No dependence on upstream changes.** It works with Next.js as it ships today.
- **Runtime first.** No build step is required in the host app.

## Why

`@module-federation/nextjs-mf` is in maintenance mode (module-federation/core#3153) and never supported the
App Router. `next-federation` is a fresh successor designed for the App Router era.

---

`next-federation` is a community project and is not affiliated with or endorsed by Vercel.
Next.js is a trademark of Vercel, Inc.

## Development

Requires Node >= 24 and pnpm 10 for the workspace; the published packages target Node >= 20.9.
See [AGENTS.md](AGENTS.md) for the repo map and commands, and [docs/conventions.md](docs/conventions.md)
for code conventions. Released under the [MIT licence](LICENSE).
