# @next-federation/router

**Internal: imported by generated shims and host modules; do not import it in application code.**
Its runtime exports can change in a minor release. Remote components keep their own router
(`next/link`, `next/navigation`, React Router, or a plain `<a href>`), and the remote's build
rewires those imports to this package. Hosts give remote links their router with
`provideNavigation` (`@next-federation/react/components`), or nothing at all on a Next.js host. See
[Links that work in every host](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components.md#links-that-work-in-every-host).

The one entry an application uses is `./build`, in an Rspack or webpack remote's config:

```ts
import { routerSharedEntry, routerShimAliases } from '@next-federation/router/build'

const shared = { ...hostProvidedReact, ...routerSharedEntry() }
// resolve: { alias: routerShimAliases() }, or routerShimAliases({ reactRouter: true })
```

- `routerShimAliases({ reactRouter?, root? })`: exact `$` aliases from `next/link` and
  `next/navigation` (with `reactRouter`, also `react-router` and `react-router-dom`) to this
  install's shims, and from `@next-federation/router` to this install's own entry, absolute paths.
  With `reactRouter` it needs `react-router` installed in a `node_modules` of `root` (default: the
  working directory) or a parent folder, and throws otherwise.
- `routerSharedEntry()`: `{ '@next-federation/router': { singleton: false, version, requiredVersion, import: '@next-federation/router' } }`.
  `requiredVersion` is `>=<major>.<minor>.0 <1.0.0` on 0.x and `^<version>` from 1.0. `import` is
  the package name, never a path (it is copied into the published `remoteEntry.js`); the alias
  above makes it this install's own file, so use both.
- `routerEntryFile()`: this install's entry, absolute (the Vite plugin's shared config; it never
  reaches the build's output).

## What is inside (for maintainers)

- `.`: `Link`, `useNavigate`, `usePathname`, `useSearchParams`, `createRouterModule`,
  `provideRouter`, `ROUTER_SHARE_NAME`, `ROUTER_VERSION`. With no host router registered, these are
  the document router: full page loads, `popstate` and the Navigation API's `currententrychange`
  tracked, a server snapshot of `''`. On a host with a `basePath` or locale, its `href` does not
  get the prefix.
- `./shims/next-link`, `./shims/next-navigation`, `./shims/react-router`: what the build aliases a
  remote's imports to. The React Router shim imports the real package by the private name
  `@next-federation/router/real-react-router`, which the build resolves to the remote's own
  `react-router`.
- `./host-navigation`: `navigationModule(hooks)`, behind `provideNavigation`.
- `./next-host`: `guardNextLink`, `guardNextNavigation`, `guardNextRouter`: Next's own `next/link`,
  `next/navigation` and `next/router` with the guards every router module has, as
  `@next-federation/next`'s components entries share them with remotes that list them in `shared`.
- `./react-router`: `reactRouterModule()`, for the React Router framework host.

The shared name `@next-federation/router` and the `RouterModule` shape stay compatible across the
`<1.0.0` range, so old remotes keep working with new hosts.
