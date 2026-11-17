# @next-federation/island

Remote-side runtime for `next-federation` islands. Peer dependencies: `react ^19` and `react-dom ^19`.

```tsx
import { Link, getIdentity } from '@next-federation/island'
```

- `Link` renders a real `<a href>` (works before hydration, with modifier clicks and in a new tab).
  Internal hrefs (a single leading `/`) get the host's `basePath` and locale; plain left clicks go
  through the host router. `useIslandBridge` and `BridgeProvider` expose the bridge itself.
- `getIdentity()` returns the verified host identity inside Server Components and Server Actions.
  The client build throws `NF-002`: pass what a client component needs as props.
- `@next-federation/island/bootstrap` is the browser runtime (`createIslandBootstrap`) that the
  bundler plugin wires up. It hydrates an island with the island's own React and a flight client
  scoped to the build's absolute base URL, so two builds of one remote can share a page.
- `initIslandShareScope(shared)` (also at `@next-federation/island/share-scope`, which imports no
  React) puts the build's React into the page's island share scope and resolves each lib to the
  first registered copy of the same exact version. Any failure falls back to the build's own copies.
  `@next-federation/vite` calls it for you.

## Server Actions reach client components as props

`callServer` is per island root. Pass a Server Action from a Server Component to a client
component as a prop. A client module that imports a `'use server'` function directly would get a
page-global `callServer`, which can cross islands (the Vite plugin rejects that with `NF-034`).
Each call posts to the remote build that rendered the island, with that island's token.

Use `<Form action={action}>` instead of `<form action>`: its fields stay disabled until the island
has hydrated (islands have no progressive enhancement). Wrap an action in
`requireIdentity(fn)` to refuse calls without a verified token (`401 NF-014`).

## Install

```sh
pnpm add @next-federation/island react react-dom
```

## API

| Export                                              | Entry                                 | Purpose                                                  |
| --------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| `Link`, `LinkProps`                                 | `@next-federation/island`             | Host-aware link.                                         |
| `useIslandBridge`, `BridgeProvider`, `serverBridge` | `@next-federation/island`             | The bridge to the host (navigation, `basePath`, locale). |
| `getIdentity()`                                     | `@next-federation/island`             | Verified identity; throws `NF-002` in client code.       |
| `createIslandBootstrap`, `registerFlightScope`      | `@next-federation/island/bootstrap`   | Browser runtime wired by `@next-federation/vite`.        |
| `initIslandShareScope(shared, options?)`            | `@next-federation/island/share-scope` | Join the page's island share scope.                      |

## Constraints

Props are plain JSON, React context does not cross into an island, islands cannot be nested, and
there is no CSS isolation. See [Limits](../../docs/guides/limits.md) and
[Writing an island remote](../../docs/guides/writing-an-island-remote.md).
