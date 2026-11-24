# @next-federation/island

Remote-side runtime for `next-federation` islands: the host-aware `Link`, `Form`, `getIdentity()` and the browser bootstrap. Peer dependencies: `react ^19` and `react-dom ^19`.

## Install

```npm
npm install @next-federation/island react react-dom
```

## Usage

```tsx title="src/islands/ProductPanel.tsx"
import { Link, getIdentity } from '@next-federation/island'

export default function ProductPanel({ sku }: { sku: string }) {
  const identity = getIdentity() // the verified host identity, or null
  return (
    <Link href={`/products/${sku}`}>
      Open {sku} for {identity?.sub ?? 'guest'}
    </Link>
  )
}
```

## Entry points

| Entry                                 | Exports                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@next-federation/island`             | `Link`, `Form`, `getIdentity`, `requireIdentity`, `useIslandBridge`, `BridgeProvider`, `serverBridge`, `LinkProps`, `FormProps` |
| `@next-federation/island/bootstrap`   | `createIslandBootstrap`, `createCallServer`, `registerFlightScope`, `initIslandShareScope`                                      |
| `@next-federation/island/share-scope` | `initIslandShareScope` (imports no React)                                                                                       |

## API

### Link

Renders a real `<a href>`, so it works before hydration, with modifier clicks and in a new tab. Internal hrefs (a single leading `/`) get the host's `basePath` and locale, and plain left clicks go through the host router.

| Prop       | Type      | Default | Description                                        |
| ---------- | --------- | ------- | -------------------------------------------------- |
| `href`     | `string`  | none    | The destination. Required.                         |
| `prefetch` | `boolean` | on      | Set `false` to skip prefetching on hover or focus. |

It also accepts every other `<a>` prop.

### Form

A `<form>` for Server Actions in an island. Its fields stay disabled until the island has hydrated, because islands have no progressive enhancement. Use it instead of `<form action>`.

| Prop       | Type      | Default | Description                                   |
| ---------- | --------- | ------- | --------------------------------------------- |
| `disabled` | `boolean` | none    | Keeps the form disabled even after hydration. |

It also accepts every other `<form>` prop.

```tsx
<Form action={addToCart}>
  <button type="submit">Add</button>
</Form>
```

### getIdentity()

Returns the verified host identity, or `null`, inside Server Components and Server Actions. The client build throws `NF-002`: pass what a client component needs as props.

### requireIdentity(fn)

Wraps a Server Action so a call without a verified token is refused (`401 NF-014`).

### useIslandBridge() and BridgeProvider

`useIslandBridge()` returns the host navigation bridge of the island a component renders in (`navigate`, `prefetch`, `basePath`, `locale`). `BridgeProvider` supplies one, and `serverBridge` is the bridge used on the server.

### createIslandBootstrap

The browser runtime at `@next-federation/island/bootstrap`. `@next-federation/vite` wires it up for you. It hydrates an island with the island's own React and a flight client scoped to the build's absolute base URL.

### initIslandShareScope(shared, options?)

Puts the build's React into the page's island share scope and resolves each lib to the first registered copy of the same exact version. A failure falls back to the build's own copies. `@next-federation/vite` calls it for you.

| Option     | Type                   | Default | Description                                  |
| ---------- | ---------------------- | ------- | -------------------------------------------- |
| `resolved` | `Map<string, unknown>` | none    | Filled as libs resolve.                      |
| `from`     | `string`               | none    | Names this build in the entries it provides. |

### createCallServer and registerFlightScope

Lower-level pieces of the bootstrap: `createCallServer` builds the per-island `callServer` for Server Actions, and `registerFlightScope` registers a build's flight scope.

## Learn more

- [Writing an island remote](https://github.com/tariqule/next-federation/blob/main/docs/guides/writing-an-island-remote.mdx)
- [Server Actions](https://github.com/tariqule/next-federation/blob/main/docs/guides/server-actions.mdx): pass a Server Action to a client component as a prop, not by import
- [Limits](https://github.com/tariqule/next-federation/blob/main/docs/guides/limits.mdx)

License: MIT
