# example-header-remote-rspack

**Remote** (remote components, **Rspack** and Module Federation 2.0, remote name `header`).
Exposes `./Header`, `./SearchBox`, `./MiniCart` and `./AddToCart`, React client components that
the [storefront](../storefront/README.md) renders in its own React tree, on both of its routers. It
has no UI of its own.

This is how a remote built with another bundler works with next-federation: any Module
Federation 2.0 build that emits `mf-manifest.json`. Here it is Rspack 2.3 with
`@module-federation/enhanced` 2.9.3, following the tested setup
(`test/fixtures/components-remote-rspack`):

- `rspack.config.ts`: two builds, the browser copy (ES modules) and one CommonJS file for the
  hosts' server rendering, in `dist/<buildId>/client/`.
- `scripts/build.ts`: runs both, then `nf-describe`, which records the server entry, hashes every
  server file and writes the descriptor, signed with `NF_COMPONENTS_SIGNING_KEY` (the demo key in
  the git-ignored `.env.local`, from `pnpm examples:keys`).
- `nf-serve` serves the builds and `/_nf/components.json`.

What the components show:

- **Two host contexts.** `MiniCart` and `AddToCart` read the host's cart, `Header` and `MiniCart`
  the host's session. Both context packages are host-provided shared modules (`import: false`): the
  remote never bundles them, so it reads the host's context objects.
- **The host's router.** `Header` writes its links with plain `next/link`. `rspack.config.ts`
  rewires that import with `routerShimAliases()` and shares what it runs on with
  `routerSharedEntry()` (both from `@next-federation/router/build`, in both builds), so the links
  navigate with the storefront's router and get its `/store` basePath. In an SPA that calls
  `provideNavigation` they use its router; in a host with none they are plain links. `SearchBox`
  calls the host's `onSearch`, which navigates with the host's router. Remote components take any
  props, functions and components included.
- **A shared module with a fallback.** [`example-design-system`](../design-system/README.md) is a
  bundled, non-singleton share requiring `^2.0.0`. The storefront passes its copy, so the remote
  uses it; a host that passes none gets the remote's own copy.

Why not share `next/link` itself (`import: false`, host-provided)? It would exist only in a Next.js
host, and an Rspack build's descriptor has no per-component list of shared modules, so every
exposed component would then need it: an SPA host could load none of them (`NF-036`; see "Rspack
and webpack remotes get coarser checks" in [Limits](../../../docs/guides/limits.mdx)). The rewired
`next/link` works on every host. See
[Links that work in every host](../../../docs/guides/remote-components/links.mdx).

## Run it

Part of the [commerce platform](../README.md) (`pnpm examples:platform`). Alone:

```sh
pnpm examples:keys                                   # once: demo signing keys
pnpm --filter example-header-remote-rspack build     # dist/<buildId>/, signed descriptor
pnpm --filter example-header-remote-rspack start     # nf-serve on 127.0.0.1:13404
```

Check it: <http://127.0.0.1:13404/_nf/components.json>. In the storefront, turn on **How is this
page built?**: the header pieces say "SSR on host (signed)". Without the matching public key the
storefront would render them in the browser only (`NF-028`).

Guide: [Remotes built with Rspack or webpack](../../../docs/guides/remote-components/rspack-remote.mdx).
