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

See [Limits](limits.md).
