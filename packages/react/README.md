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

The island wire format is specified in [`docs/protocol/v1.md`](https://github.com/tariqule/next-federation/blob/main/docs/protocol/v1.md).

License: MIT
