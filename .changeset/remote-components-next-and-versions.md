---
'@next-federation/protocol': minor
'@next-federation/core': minor
'@next-federation/react': minor
'@next-federation/vite': minor
'@next-federation/next': minor
'@next-federation/sdk': minor
---

Remote components get the host's Next.js router modules and shared-module version negotiation.

- `@next-federation/next/components` (App Router) and `@next-federation/next/pages/components` (Pages Router) provide the host's own `next/link` and `next/navigation` or `next/router` to remote components. Remotes list them in `shared`; a remote component that needs a module the host does not provide (another router's, or any `next/*` in an SPA) renders its fallback with the new `NF-036`.
- A remote's `shared` entries take `requiredVersion` (checked by the host before loading, `NF-036` when unsatisfied) and `fallback: true` (the remote bundles its own copy, used when the host's copy is missing or outside the range). React never falls back. The descriptor lists each shared module with its range, its fallback flag and the exposed modules that import it, signed with the rest.
- Host shared modules need their real semver `version` (`NF-002` otherwise). `registerSharedModules` provides modules to every remote component. `withNextFederation` records the host's Next.js version (`env.NF_NEXT_VERSION`).
- Docs: "Mode A" is now "remote components" and "Mode B" "islands"; the guide moved to `docs/guides/remote-components.md`.

**Upgrade hosts before remotes:** an older host computes the descriptor digest without `shared`, so it refuses a new remote build that shares modules besides React with `NF-027` (rendered in the browser only).
