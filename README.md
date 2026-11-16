# next-federation

Runtime composition of React UI from separately deployed apps, for **Next.js 16**
(App Router and Pages Router, Turbopack or webpack) and, later, **React Router**.

> **Status: foundations.** The shared packages are implemented; the Next.js and Vite adapters are
> still to come. See the [design document](docs/specs/2026-11-13-federation-lib-design.md).

## Packages

| Package                                          | Purpose                                                       |
| ------------------------------------------------ | ------------------------------------------------------------- |
| [`@next-federation/sdk`](packages/sdk)           | Error codes (`NF-001` to `NF-025`) and the category logger.   |
| [`@next-federation/protocol`](packages/protocol) | Island protocol v1: envelope, request codec, bootstrap types. |
| [`@next-federation/core`](packages/core)         | `defineFederation`, `fetchIsland`, island identity tokens.    |
| [`@next-federation/react`](packages/react)       | `FederationErrorBoundary`.                                    |

The wire contract is published at [`docs/protocol/v1.md`](docs/protocol/v1.md).

## What it will do

- **Client components (Mode A):** load interactive components from a remote app at runtime and render
  them inside your React tree, sharing context. Built on the Module Federation 2.0 runtime.
- **RSC islands (Mode B):** remotes run **real React Server Components** on their own servers. Your app
  embeds the result as a self-contained, server-rendered, hydrated island. It supports per-user content,
  Server Actions, remotes on any origin, and smooth client-side navigation.

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
