# @next-federation/router

**Internal: imported by generated shims and host modules. Do not import it in application code.** Its runtime exports can change in a minor release.

A remote's components keep their own router (`next/link`, `next/navigation`, React Router or a plain `<a href>`), and the remote's build rewires those imports to this package. Hosts give remote links their router with `provideNavigation` from `@next-federation/react/components`, or nothing at all on a Next.js host. See [Links that work in every host](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/links.mdx).

## Install

```npm
npm install @next-federation/router
```

You only install it directly to use `./build` in an Rspack or webpack remote.

## Usage

```ts title="rspack.config.ts"
import { routerSharedEntry, routerShimAliases } from '@next-federation/router/build'

const shared = { ...hostProvidedReact, ...routerSharedEntry() }
// resolve: { alias: routerShimAliases() }, or routerShimAliases({ reactRouter: true })
```

## API

### @next-federation/router/build

The one entry an application uses.

#### routerShimAliases(options?)

Returns exact `$` aliases from `next/link` and `next/navigation` (with `reactRouter`, also `react-router` and `react-router-dom`) to this install's shims, and from `@next-federation/router` to this install's own entry. All paths are absolute.

| Option        | Type      | Default           | Description                                                                                                                            |
| ------------- | --------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `reactRouter` | `boolean` | `false`           | Also alias `react-router` and `react-router-dom`. Needs `react-router` in a `node_modules` of `root` or a parent folder, or it throws. |
| `root`        | `string`  | working directory | Where to look for `react-router`.                                                                                                      |

#### routerSharedEntry()

Returns the Module Federation `shared` entry for `@next-federation/router`: `{ singleton: false, version, requiredVersion, import: '@next-federation/router' }`. `requiredVersion` is `>=<major>.<minor>.0 <1.0.0` on 0.x and `^<version>` from 1.0. Use it together with `routerShimAliases()`: the alias makes the `import` name this install's own file.

#### routerEntryFile()

This install's entry, as an absolute path. The Vite plugin uses it for its shared config; it never reaches the build's output.

#### routerShimFile and reactRouterDirectory

Lower-level helpers behind `routerShimAliases`.

### Other entries (for maintainers)

| Entry                                                                  | Exports                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                                                                    | `Link`, `useNavigate`, `usePathname`, `useSearchParams`, `createRouterModule`, `provideRouter`, `ROUTER_SHARE_NAME`, `ROUTER_VERSION` |
| `./shims/next-link`, `./shims/next-navigation`, `./shims/react-router` | What the build aliases a remote's imports to.                                                                                         |
| `./host-navigation`                                                    | `navigationModule(hooks)`, behind `provideNavigation`.                                                                                |
| `./next-host`                                                          | `guardNextLink`, `guardNextNavigation`, `guardNextRouter`: Next's own modules with the guards every router module has.                |
| `./react-router`                                                       | `reactRouterModule()`, for the React Router framework host.                                                                           |

With no host router registered, the `.` exports are the document router: full page loads, `popstate` and the Navigation API's `currententrychange` tracked, and a server snapshot of `''`. The shared name `@next-federation/router` and the `RouterModule` shape stay compatible across the `<1.0.0` range, so old remotes keep working with new hosts.

License: MIT
