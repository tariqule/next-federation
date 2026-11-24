# NF-036: Host does not provide a shared module version the remote component accepts

## What happened

A remote component imports a module that its remote lists in `shared` as host-provided (no
`fallback`). The host does not provide that module, or it provides a version outside the remote's
`requiredVersion`. The host does not load the component. It renders the component's fallback, and
the page still answers 200. The log line names the remote, the exposed module, the shared module,
the range the remote needs and the version the host has.

## Why

- **A Next.js module in a host without it.** `next/link`, `next/navigation` and `next/router` come
  only from a Next.js host, and only the modules of the host's router:
  - App Router hosts provide `next/link` and `next/navigation` through
    `@next-federation/next/components`.
  - Pages Router hosts provide `next/link` and `next/router` through
    `@next-federation/next/pages/components`.

  A client-only (SPA) host provides none of them. A host that imports `createRemoteComponent` from
  `@next-federation/react/components` instead of the Next.js entry provides none of them either.
- **A module the host does not pass.** The remote shares a module (a context package, a design
  system) that the host does not list in `createRemoteComponent({ shared })` or
  `registerSharedModules`.
- **A version outside the range.** The host's `version` for the module does not satisfy the
  remote's `shared: { name: { requiredVersion } }`.

Only the exposed modules that import the shared module are refused. Other components of the same
remote still load. React is the exception: when the host's React is outside the range, every
component of that build is refused, even one that never imports React, because hosts assume
`^19.0.0` for any React module a descriptor does not list and a React entry cannot be limited to
some exposed modules. The check runs before any remote code is fetched, and a refused load is never
retried, because a retry cannot succeed.

## How to fix

- **React outside the range** (a React 18 host, a remote that accepts React 19 only): set the
  remote's `react` range to one the host's React satisfies, such as `'^18.3.0 || ^19.0.0'`
  ([React versions](../guides/remote-components.md#react-versions)), and rebuild it; or move the
  host to React 19. React never falls back to a remote's own copy.
- Create Next.js hosts' remote components with the entry for the host's router:
  `@next-federation/next/components` (App Router) or `@next-federation/next/pages/components`
  (Pages Router). Wrap `next.config` with `withNextFederation`, which records the host's Next.js
  version.
- A component meant for every kind of host can keep `next/link`, `next/navigation` or React Router:
  do not list them in the remote's `shared`, and the build rewires them to the host's router
  ([Links that work in every host](../guides/remote-components.md#links-that-work-in-every-host)).
  Other `next/*` modules (`next/router`, `next/image`, ...) need a Next.js host.
- Pass every other shared module from the host with its real version, for example
  `shared: { '@acme/ui': { version: '2.4.0', module: AcmeUi } }`. The version comes from the
  package's `package.json`.
- If the remote can run with its own copy, set `fallback: true` on that entry in the remote's
  `shared` option. The remote then bundles a copy and uses it when the host's copy is missing or
  does not satisfy the range. React and `next/*` never fall back: they are always the host's.

## As a warning

`<remote> bundles its own "<name>" (host has <version>, remote needs "<range>")` is the same code,
logged once per remote and module as a warning. The module is a `fallback: true` entry (such as
`@next-federation/router`, the internal package a remote's rewired links run on, which remote
builds share that way by default), and the host's copy is outside the remote's range. The
component still renders, with the remote's own copy. For `@next-federation/router` that copy is
the document router: the remote's links do full page loads and, on a host with a `basePath` or
locale, lack the prefix. Upgrade the host's `@next-federation/next` or `@next-federation/react`,
or widen the remote's range. See [Links that work in every
host](../guides/remote-components.md#links-that-work-in-every-host).

See [Remote components: sharing modules](../guides/remote-components.md#sharing-modules).
