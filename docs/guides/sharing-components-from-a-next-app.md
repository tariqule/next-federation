# Sharing components from a Next.js app

A Next.js app does not expose its `app/` folder or its pages at runtime. There is no way to import a
component from another team's Next app and render it in yours.

To share UI from a team that builds with Next.js, publish an island remote instead:

1. Move the shared components into a separate Vite package. Keep it small: a remote owns its own
   data access and styles.
2. Build it with `@next-federation/vite` ([Writing an island remote](writing-an-island-remote.md)).
   Each shared component becomes an island entry (a Server Component) that renders the existing
   client components.
3. Deploy it as its own app ([Deployment](deployment.md)).
4. In the Next app, and in every other host, add it to `remotes` and render it with `RemoteIsland`
   ([App Router](getting-started-app-router.md) or [Pages Router](getting-started-pages-router.md)).

What carries over:

- Client components work unchanged inside an island, if they only need props and their own state.
- Anything that used host-only context, router hooks or Next-specific modules (`next/image`,
  `next/navigation`) must be rewritten. React context does not cross into an island.

What changes for callers:

- Props become plain JSON, and the island is a separate server hop.
- Navigation goes through `Link` from `@next-federation/island`.

## Another option: a remote-components remote

For a small interactive client component that must read the host's React context or use its
router, share it as a remote component instead. It is still a separate build, with Vite and
`nextFederationComponents` or with Rspack and `nf-describe`; the Next app itself cannot be the
remote. The host renders it with `createRemoteComponent` and it runs on the host's React.

- Only `next/link`, `next/navigation` and `next/router` can be shared, and the host provides
  them (which ones depends on its router). Other `next/*` modules (`next/image`, `next/head`, …) cannot be shared
  ([NF-002](../errors/invalid-config.md)): pass what the component needs as props.
- Next.js hosts server-render it only when the remote's build is signed or pinned. Any other
  build renders in the browser only.

Keep the island path for anything the remote should render on its own server. See
[Remote components](remote-components.md) and its
[Islands or remote components?](remote-components.md#islands-or-remote-components) table.

See [Limits](limits.md).
