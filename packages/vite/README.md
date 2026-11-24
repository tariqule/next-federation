# @next-federation/vite

Vite 8 plugins that build an island remote (`nextFederationIslands`) or a remote components build (`nextFederationComponents`). Requires Node `^20.19.0 || >=22.12.0`. The island plugin wraps [`@vitejs/plugin-rsc`](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-rsc), pinned to exactly 0.5.39 (`NF-025` otherwise).

## Install

```npm
npm install --save-exact react@19.3.1 react-dom@19.3.1 react-server-dom-webpack@19.3.1
npm install -D @next-federation/vite @next-federation/server vite
```

`react-server-dom-webpack` must match your React version exactly and be a patched release ([NF-041](https://github.com/tariqule/next-federation/blob/main/docs/errors/vulnerable-react-server-dom.md)). A components remote does not need it. See [Writing an island remote](https://github.com/tariqule/next-federation/blob/main/docs/guides/writing-an-island-remote.mdx).

## nextFederationIslands(options)

Returns the Vite plugin array for an island remote. An island entry is a Server Component with a default export and no `'use client'` (`NF-002`).

```ts title="vite.config.ts"
import { nextFederationIslands } from '@next-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: nextFederationIslands({
    name: 'shop',
    base: 'https://shop.example.com/',
    hosts: ['https://www.example.com'],
    issuers: { 'https://www.example.com': 'https://www.example.com/api/next-federation/jwks' },
    islands: {
      ProductPanel: './src/islands/ProductPanel.tsx',
      MyOrders: { entry: './src/islands/MyOrders.tsx', private: true },
    },
  }),
})
```

`vite build` writes `dist/<buildId>/{client,ssr,rsc}` and `nf-build.json`. Serve it with `nf-serve --dir dist --port <port>` from `@next-federation/server`.

| Option              | Type                                                             | Default                                    | Description                                                    |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `name`              | `string`                                                         | required                                   | Remote id. Matches `^[A-Za-z][A-Za-z0-9_-]*$`.                 |
| `base`              | `string`                                                         | required                                   | Absolute URL the remote is served from (`NF-020` if relative). |
| `islands`           | `Record<string, string \| { entry: string; private?: boolean }>` | required                                   | Islands to build. `private: true` requires a verified token.   |
| `hosts`             | `string[]`                                                       | required                                   | Exact host origins allowed to embed the remote. No `'*'`.      |
| `issuers`           | `Record<string, string>`                                         | none                                       | Issuer to JWKS URL map for identity verification.              |
| `buildId`           | `string`                                                         | `NF_BUILD_ID`, then `'dev'` or a timestamp | Matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`.                  |
| `versioned`         | `boolean`                                                        | `true` for build, `false` for serve        | Pin assets under `<base>b/<buildId>/`.                         |
| `maxAge`            | `number`                                                         | `60`                                       | Public island `max-age`, in seconds.                           |
| `outDir`            | `string`                                                         | `'dist'`                                   | Output folder.                                                 |
| `share`             | `boolean \| { libs?: string[] }`                                 | `true` for build, `false` for serve        | Share React with other island remotes. `libs` adds specifiers. |
| `allowInsecureHttp` | `boolean`                                                        | `false`                                    | Accept plain-`http` `base` or JWKS URL in production. Warns.   |
| `actions`           | `{ requireIdentity?, maxBodyBytes?, timeoutMs? }`                | none                                       | Server Action settings (below).                                |

| `actions` option  | Type      | Default   | Description                                                               |
| ----------------- | --------- | --------- | ------------------------------------------------------------------------- |
| `requireIdentity` | `boolean` | `false`   | Every Server Action needs a verified token (`401 NF-014`).                |
| `maxBodyBytes`    | `number`  | `1048576` | Server Action body limit.                                                 |
| `timeoutMs`       | `number`  | none      | Browser aborts a slow call and rejects with `NF-038`. The action may run. |

`base` and JWKS URLs must use `https`, except for loopback hosts, `serve`, or `NODE_ENV` of `development` or `test`.

## nextFederationComponents(options)

Returns the Vite plugins for a components remote. It wraps `@module-federation/vite`, pinned to exactly 1.24.0 (`NF-026` otherwise; `NF_ALLOW_MF_VITE=1` for a canary job).

```ts title="vite.config.ts"
import { nextFederationComponents } from '@next-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    nextFederationComponents({
      name: 'shop',
      base: 'https://shop.example.com/',
      exposes: { './Cart': './src/Cart.tsx' },
      shared: { '@acme/date-utils': { requiredVersion: '^2.0.0', fallback: true } },
    }),
  ],
})
```

| Option              | Type                                              | Default     | Description                                                              |
| ------------------- | ------------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `name`              | `string`                                          | required    | Module Federation container name. A JavaScript identifier.               |
| `base`              | `string`                                          | required    | Absolute URL the remote is served from.                                  |
| `exposes`           | `Record<string, string>`                          | required    | Exposed modules, such as `{ './Cart': './src/Cart.tsx' }`.               |
| `shared`            | `string[] \| Record<string, SharedModuleOptions>` | none        | Modules the host provides, besides React.                                |
| `react`             | `string`                                          | `'^19.0.0'` | Accepted React range. A host outside it renders its fallback (`NF-036`). |
| `links`             | `boolean`                                         | `true`      | Route the remote's links through the host's router.                      |
| `buildId`           | `string`                                          | see islands | The build id.                                                            |
| `outDir`            | `string`                                          | `'dist'`    | Output folder. Builds go to `<outDir>/<buildId>`.                        |
| `ssr`               | `boolean`                                         | `true`      | Build the CommonJS server copy hosts render on the server.               |
| `allowInsecureHttp` | `boolean`                                         | `false`     | Accept plain-`http` `base` in a production build. Warns.                 |
| `types`             | `boolean`                                         | `false`     | Emit signed declarations into `client/@mf-types/` for `nf-types`.        |

`SharedModuleOptions` takes `requiredVersion` (semver range the host copy must satisfy) and `fallback` (bundle this build's own copy). `react`, `react-dom` and `next` cannot set `fallback: true` (`NF-002`).

- `vite build` writes `client/` and the server copy, `nf-components.json` (signed with ES256 when `NF_COMPONENTS_SIGNING_KEY` holds a private JWK) and `nf-build.json`.
- The dev server answers `/_nf/components.json` with `ssr: null`, so dev remotes render in the browser only.
- `types: true` needs TypeScript 5 or 6 and publishes declarations of exposed modules and their local imports. Do not expose a module whose types reach a secret.
- Programmatic builds set `NF_VITE_COMMAND=build`.

See [Links that work in every host](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/links.mdx) and [Keeping a standalone app](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/vite-remote.mdx#keep-a-standalone-app).

## resolveOptions(options, ctx)

Validates the island options (`NF-020` for a relative `base`, `NF-002` otherwise) and returns the resolved shape. `ctx` is `{ command, env, now }`.

## Types

`IslandRemoteOptions`, `ResolveContext`, `ResolvedOptions`, `BuildInfo` (`{ name, buildId, builtAt, base }`), `ComponentsRemoteOptions`, `SharedModuleOptions` and `ComponentsBuildInfo` (`kind: 'components'`).

## Build behaviour

Details are in [Writing an island remote](https://github.com/tariqule/next-federation/blob/main/docs/guides/writing-an-island-remote.mdx) and [Limits](https://github.com/tariqule/next-federation/blob/main/docs/guides/limits.mdx). Not covered there:

- The page-wide share scope is `__FEDERATION__.__SHARE__['@next-federation/island-share@1']['nf-islands']`. `react-server-dom-webpack` is never shareable (`NF-002`).
- `server.forwardConsole` is `false` unless your config sets it.
- Dev CORS: Vite's CORS middleware is off. Assets get CORS for `hosts` only.

## Learn more

- [Server Actions](https://github.com/tariqule/next-federation/blob/main/docs/guides/server-actions.mdx)
- [Remote components](https://github.com/tariqule/next-federation/blob/main/docs/guides/remote-components/overview.mdx)
- [Deployment](https://github.com/tariqule/next-federation/blob/main/docs/guides/deployment.mdx)

License: MIT
