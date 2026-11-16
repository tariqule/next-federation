# example-cart-context

A tiny React context package shared by the example hosts and the
[client-components remote](../components-remote/README.md): `CartProvider` (hosts) and `useCart()`
(hosts and the remote's `CartButton`).

It shows how a remote client component reads the **host's** React context. The remote lists this
package in `shared`, so it is never bundled into the remote: at runtime the remote receives the
host's own module (passed in `createRemoteComponent({ shared })`), and with it the host's context
object. Plain JavaScript, so hosts can use it without a build step.
