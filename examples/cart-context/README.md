# example-cart-context

**Shared package**, not an app. The hosts and [`components-remote`](../components-remote/README.md)
both use it, so the remote's `CartButton` reads the host's cart.

A small React context package shared by the example hosts and the
[components remote](../components-remote/README.md): `CartProvider` (used by the hosts) and
`useCart()` (used by the hosts and by the remote's `CartButton`).

## What it shows

How a remote component reads the host's React context. The remote lists this package in `shared`,
so it never bundles it. At runtime the remote receives the host's own module (passed in
`createRemoteComponent({ shared })`), and with it the host's context object. The package is plain
JavaScript, so hosts use it without a build step.

## Run it

It is a library, so nothing runs on its own. `pnpm examples:dev` from the repository root starts the
hosts and the remote that use it.

Guide: [Remote components](../../docs/guides/remote-components.md#sharing-modules).
