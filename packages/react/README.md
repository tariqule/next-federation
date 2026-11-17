# @next-federation/react

React components for `next-federation`. Peer dependencies: `react ^19` and `react-dom ^19`.

```tsx
import { FederationErrorBoundary } from '@next-federation/react'
;<FederationErrorBoundary fallback={(error) => <p>Widget unavailable</p>} onError={(error) => report(error)} resetKey={route}>
  <Island />
</FederationErrorBoundary>
```

A failing island renders `fallback` instead of crashing the host page. The boundary resets
when `resetKey` changes. The entry is marked `'use client'`, so it can be imported from
Server Components in the App Router.

## Install

```sh
pnpm add @next-federation/react react react-dom
```

## API

| Export                         | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `FederationErrorBoundary`      | Error boundary with `fallback`, `onError` and `resetKey`. |
| `FederationErrorBoundaryProps` | Its props type.                                           |
| `IslandMount`                  | Host-side mount that hydrates a remote island envelope.   |
| `IslandMountProps`             | Its props type.                                           |
| `getLiveIslandCount`           | Number of island roots mounted on the page.               |
| `ISLAND_EVENT`                 | `'nf:island'`, the bubbling DOM event of every island.    |
| `IslandClientEvent`            | The detail type of that event (and of `onEvent`).         |

`IslandMount` writes the island HTML once and keeps the island root alive across host
re-renders, StrictMode and hidden `<Activity>`. It tears the root down once its container has
left the document. An uncaught error inside the island renders `errorFallback` instead. That
fallback stays for the failed build; an envelope with a new `buildId` or `bootstrap` URL mounts
a fresh container and bootstraps the island again. A bootstrap that fails to load leaves the
server HTML in place and marks the island `inert`.
The container's `data-nf-state` becomes `live` (and `island:hydrate` fires) only once the
island's hydration has committed, so the island is interactive from that point.
`IslandMount` also renders the envelope's stylesheets as
`<link rel="stylesheet" precedence="next-federation">`. React puts each href in the page once,
however many islands use it, and keeps it. A server render emits the links ahead of the island
HTML, so the island never paints unstyled; in the browser React adds them to `<head>`.

## Remote components (`@next-federation/react/components`)

A remote's client component, loaded through the Module Federation runtime and rendered in
the host's React tree on the host's React (server-rendered by Next hosts for verified builds).

```tsx
'use client'
import { createRemoteComponent } from '@next-federation/react/components'

export const Cart = createRemoteComponent<{ items: number }>({
  expose: './Cart',
  shared: { '@acme/host-context': { version: '1.0.0', module: HostContext } },
  fallback: <p>Cart unavailable</p>,
})
// <Cart descriptor={descriptor} items={3} />  (descriptor: from @next-federation/next, or
// fetchDescriptorInBrowser() in an SPA)
```

| Export                                       | Purpose                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `createRemoteComponent(options)`             | Binds an exposed component; renders `ErrorBoundary > Suspense > component`.   |
| `loadRemoteModule(descriptor, expose)`       | The exposed module itself (cached per build).                                 |
| `preloadRemoteComponent(descriptor, expose)` | Starts loading ahead of rendering (never rejects).                            |
| `fetchDescriptorInBrowser(url, options?)`    | SPA: the current build, browser-only (`ssr: null`).                           |
| `registerSharedModules(shared)`              | Provides modules to every remote component (`{ name: { version, module } }`). |
| `COMPONENT_EVENT`                            | `'nf:component'`, the `document` event of every load and failure.             |

The module is `'use client'` and imports `react`, `react-dom`, `react-dom/client` and
`react/jsx-runtime` itself, so in Next each layer registers its own React for remotes. The server
loader (`./components/server-loader`) is selected by the `node` export condition and replaced by a
stub under `browser`, so it never reaches a client bundle. On the server it evaluates a build's
CommonJS graph only after every file matches the verified sha384 (`NF-027`), its `require` resolves
only `@module-federation/runtime` (`NF-030`), it uses `node:http` with a 3 s timeout, and it needs
Node ≥ 20.16 (`process.getBuiltinModule`; otherwise browser-only, `NF-028`). Loaded builds are cached
per remote up to the descriptor's `maxBuilds` (oldest evicted); failures are cached too (the server
retries after 1 s, the browser retries 3 times with backoff while keeping the server HTML), and
one load attempt times out after 10 s. A host module that the process-wide share cache holds in
another instance (two Reacts, or a dev server reload) makes the server render browser-only.
Shared modules: `version` must be the module's real semver version. Before loading an exposed
module, the host checks the descriptor's `shared` list for the modules that expose imports: one the
host does not provide, or provides outside the remote's `requiredVersion`, renders the fallback
(`NF-036`, never retried), unless the remote bundles a fallback copy. Next.js hosts import
`createRemoteComponent` from `@next-federation/next/components` (App Router) or
`@next-federation/next/pages/components` (Pages Router) instead, which also provide the host's
`next/*` modules.
Stylesheets listed in the descriptor are React stylesheet resources (`precedence="next-federation"`,
one link per URL): rendered with a server-rendered component, inserted with `preinit` by one first
mounted in the browser; a server render also modulepreloads the remote entry and chunks.
Guide: [Remote components](../../docs/guides/remote-components.md).

**Trust.** The server never trusts a `descriptor` prop by itself: it evaluates a build only when
`verifyComponentDescriptor` recorded the descriptor in this process, or it re-verifies the carried
JWS (or a pin) against the keys `defineFederation` registered. Pass only the value of
`getComponentDescriptor`. The `require` allow-list is not a sandbox; integrity is the boundary.

## Sharing the host's React with islands

```tsx
// The app entry (SPA main.tsx, or pages/_app.tsx), at module scope:
import { provideHostReact } from '@next-federation/react/share'
provideHostReact()
```

Islands built on the host's exact React version then use the host's React and download none of
their own. It returns `false` and does nothing in development, when React's version has a
pre-release tag (every App Router host: Next runs its own canary React), or when an island already
provides that version. Call it before the first island bootstraps; calling it later is harmless.
On such a host `IslandMount` destroys a redeployed island's old root after its effect, since that
root runs on the host's own React.

The island wire format is specified in [`docs/protocol/v1.md`](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md).

License: MIT

## Constraints

`IslandMount` hydrates server-rendered island HTML, so props are plain JSON and React context does not
cross into an island. See [Limits](../../docs/guides/limits.md) and the guides for the
[App Router](../../docs/guides/getting-started-app-router.md),
[Pages Router](../../docs/guides/getting-started-pages-router.md) and
[SPA](../../docs/guides/getting-started-spa.md).
