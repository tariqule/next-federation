# next-federation

Runtime composition of React UI from separately deployed apps, for **Next.js 16**
(App Router and Pages Router, Turbopack or webpack) and, later, **React Router**.

> **Status: design phase.** Nothing is implemented yet. See the
> [design document](docs/specs/2026-11-13-federation-lib-design.md).

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
