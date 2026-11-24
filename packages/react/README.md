# @next-federation/react

Host-side React components: `IslandMount` hydrates a remote island, `FederationErrorBoundary` contains failures, and `createRemoteComponent` renders a remote's client component. Peers: `react` and `react-dom` `^18.3.0 || ^19.0.0`.

## Install

```npm
npm install @next-federation/react react react-dom
```

## Usage

```tsx
import { FederationErrorBoundary } from '@next-federation/react'
;<FederationErrorBoundary fallback={(error) => <p>Widget unavailable</p>} onError={(error) => report(error)} resetKey={route}>
  <Island />
</FederationErrorBoundary>
```

## Entry points

| Entry                               | Exports                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@next-federation/react`            | `FederationErrorBoundary`, `IslandMount`, `getLiveIslandCount`, `ISLAND_EVENT`, `clearIslandTokens`, `createTokenClient`                                           |
| `@next-federation/react/components` | `createRemoteComponent`, `loadRemoteModule`, `preloadRemoteComponent`, `fetchDescriptorInBrowser`, `registerSharedModules`, `provideNavigation`, `COMPONENT_EVENT` |
| `@next-federation/react/share`      | `provideHostReact`, `isHostReactProvided`                                                                                                                          |

## API

### FederationErrorBoundary

An error boundary for islands. It is `'use client'`, so Server Components can import it.

| Prop       | Type                                           | Default  | Description                             |
| ---------- | ---------------------------------------------- | -------- | --------------------------------------- |
| `fallback` | `ReactNode` or `(error: unknown) => ReactNode` | required | Rendered after an error.                |
| `onError`  | `(error: unknown) => void`                     | none     | Called with the error.                  |
| `resetKey` | `unknown`                                      | none     | Renders children again when it changes. |
| `children` | `ReactNode`                                    | required | The content to protect.                 |

### IslandMount

Hydrates a remote island envelope and keeps its root alive across re-renders and StrictMode. `data-nf-state` becomes `live` after hydration.

| Prop                 | Type                                                        | Default                                      | Description                                                          |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `envelope`           | `IslandEnvelope`                                            | required                                     | From `fetchIsland`. Its HTML is rendered as is.                      |
| `bridge`             | `Partial<IslandBridge>`                                     | none                                         | Overrides for the host navigation bridge.                            |
| `token`              | `{ endpoint: string; identityKey: string \| null } \| null` | none                                         | Token endpoint and identity for per-user islands.                    |
| `errorFallback`      | `ReactNode`                                                 | none                                         | Shown after an island error or when its code cannot load (`NF-011`). |
| `inertOnLoadFailure` | `boolean`                                                   | `true` without `errorFallback`, else `false` | On bootstrap failure, keep the server HTML, marked `inert`.          |
| `onEvent`            | `(event: IslandClientEvent) => void`                        | none                                         | Called for `island:hydrate`, `island:action` and `island:error`.     |

### getLiveIslandCount()

Returns the island roots mounted on the page.

### ISLAND_EVENT

`'nf:island'`, the bubbling DOM event each island dispatches. Detail: `IslandClientEvent`.

### clearIslandTokens()

Forgets cached island tokens. Call it on sign-out.

### createTokenClient(options)

Creates the browser `TokenClient` that `IslandMount` uses. `options`: `endpoint`, `identityKey`, and optional `fetch` and `now` for tests.

### createRemoteComponent(options)

Binds an exposed client component of a components remote, in a `'use client'` module. The result has a `preload(descriptor)` method.

```tsx
'use client'
import { createRemoteComponent } from '@next-federation/react/components'

export const Cart = createRemoteComponent<{ items: number }>({
  expose: './Cart',
  fallback: <p>Loading the cart…</p>,
  errorFallback: <p>Cart unavailable</p>,
})
// <Cart descriptor={descriptor} items={3} />
```

| Option          | Type                                                   | Default    | Description                                                     |
| --------------- | ------------------------------------------------------ | ---------- | --------------------------------------------------------------- |
| `expose`        | `string`                                               | required   | Exposed module, such as `'./Cart'`. Its default export renders. |
| `fallback`      | `ReactNode`                                            | none       | Shown while loading, and on failure without `errorFallback`.    |
| `errorFallback` | `ReactNode`                                            | `fallback` | Shown when the remote fails to load or render (`NF-040`).       |
| `shared`        | `Record<string, { version: string; module: unknown }>` | none       | Modules this host provides besides React. Mismatch: `NF-036`.   |

The component takes your props plus `descriptor` (`RemoteComponentDescriptor | null`), `fallback` and `errorFallback`. Pass `descriptor` from `getComponentDescriptor` or `fetchDescriptorInBrowser`. In Next.js, import from `@next-federation/next/components` instead.

### loadRemoteModule(descriptor, expose)

Loads an exposed module of a remote build, cached per build.

### preloadRemoteComponent(descriptor, expose)

Starts loading a module early. It never rejects.

### fetchDescriptorInBrowser(url, options?)

For SPA hosts. Fetches the current descriptor in the browser with `ssr: null`, or `null` when unreachable.

| Option      | Type     | Default             | Description                |
| ----------- | -------- | ------------------- | -------------------------- |
| `remote`    | `string` | the descriptor name | The remote name to record. |
| `maxBuilds` | `number` | `5`                 | Builds kept loaded.        |

### registerSharedModules(shared)

Provides `{ name: { version, module } }` to every remote component. Call it at module scope, before anything renders.

### provideNavigation(hooks)

Gives remote links this host's router. Call it once at module scope. Without it, links do full page loads. Next.js hosts need not call it.

| Hook          | Type                                                    | Description                                  |
| ------------- | ------------------------------------------------------- | -------------------------------------------- |
| `useNavigate` | `() => (href, options?: { replace?, scroll? }) => void` | Required. React Router's `useNavigate` fits. |
| `useHref`     | `(href: string) => string`                              | Optional.                                    |
| `useLocation` | `() => { pathname: string; search: string }`            | Optional.                                    |

### COMPONENT_EVENT

`'nf:component'`, the `document` event for each load and failure. Detail: `ComponentEvent`.

### provideHostReact()

From `@next-federation/react/share`. Puts the host's React into the island share scope, so islands on the same exact React version download none. Call it at module scope of the app entry, before the first island bootstraps. It returns `false` in development, with a pre-release React (every App Router host), or when an island already provides that version.

```tsx
import { provideHostReact } from '@next-federation/react/share'

provideHostReact()
```

### Types

`FederationErrorBoundaryProps`, `IslandMountProps`, `IslandClientEvent`, `TokenClient`, `RemoteComponentOptions`, `RemoteComponentProps`, `RemoteComponentType`, `RemoteProps`, `RemoteComponentDescriptor`, `ComponentEvent`, `RemoteModule`, `SharedModules`, `NavigationHooks`.

## Learn more

- [App Router guide](https://github.com/tariqule/next-federation/blob/main/docs/guides/getting-started-app-router.mdx)
- [SPA guide](https://github.com/tariqule/next-federation/blob/main/docs/guides/getting-started-spa.mdx)
- [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/overview.mdx)

License: MIT
