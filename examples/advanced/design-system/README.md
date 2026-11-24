# example-design-system

**Shared UI library**, not an app (version 2.1.0). The [header remote](../header-remote-rspack/README.md)
uses its `Button` and `Pill`, and shares it with Module Federation as a **bundled** module that
requires `^2.0.0`:

- A host that passes its own satisfying copy to remote components (the
  [storefront](../storefront/README.md) does, in `lib/header.tsx`) has that copy used.
- A host that passes none gets the copy the remote bundled: the **fallback copy**. Nothing breaks; the page downloads one more chunk.

Each element it renders carries `data-ds-copy`, `host` or `bundled`, so you can see which copy
rendered (turn on **How is this page built?** in the hosts). `claimCopy()` exists only for this
demo.

Keep fallback copies for stateless code. A module whose identity matters, such as a React context
(`example-cart-context`, `example-session-context`), must always come from the host: two copies
would mean two contexts. See [Sharing modules](../../../docs/guides/remote-components/sharing-modules.mdx).

Part of the [commerce platform](../README.md).
