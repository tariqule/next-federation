# example-session-context

**Shared package**, not an app. A React context that says who is signed in (display name and
role, never a token). The [storefront](../storefront/README.md) renders `SessionProvider`; the
[header remote](../header-remote-rspack/README.md) reads it with `useSession()`.

The header remote lists this package as host-provided in its `shared` config, so it never bundles a
copy: it receives the host's module, and with it the host's context object. It works like
[`example-cart-context`](../../cart-context/README.md), which the same remote also reads.

The storefront's pages are static shells that cannot know the visitor, so the provider asks the
host's same-origin session route once in the browser. Islands do not use this: private islands
get the user from a signed, audience-scoped token instead ([Identity](../../../docs/guides/identity.md)).

Part of the [commerce platform](../README.md).
