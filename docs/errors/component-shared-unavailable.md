# NF-036: Host does not provide a shared module version the remote component accepts

## Why This Error Occurred

A remote component imports a module its remote lists in `shared` as host-provided, and the host does not provide it or provides a version outside `requiredVersion`. The host renders the fallback and the page still answers `200`.

## Possible Ways to Fix It

- React outside the range: widen the remote's `react` range (for example `'^18.3.0 || ^19.0.0'`) and rebuild, or upgrade the host's React.
- Next.js hosts: create components with `@next-federation/next/components` (App Router) or `@next-federation/next/pages/components` (Pages Router).
- Any other shared module: pass it from the host with its real version:

  ```ts
  shared: { '@acme/ui': { version: '2.4.0', module: AcmeUi } }
  ```

- Set `fallback: true` on the entry in the remote's `shared` if it can run with its own copy. React and `next/*` never fall back.

## Useful Links

- [Remote components: sharing modules](../guides/remote-components/sharing-modules.mdx)
- [Remote components: React versions](../guides/remote-components/reference.mdx#react-versions)
- [Remote components: links that work in every host](../guides/remote-components/links.mdx)
