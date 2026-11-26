# NF-028: Remote component rendered in the browser only

## Why This Error Occurred

The host did not render a remote component on the server. The server HTML has its fallback and the browser renders the component, also for a `browserOnly` prop. The message names the case.

Nested remotes and an uncheckable manifest are refused: `errorFallback` on the server and after hydration, and no browser request.

## Possible Ways to Fix It

- Unverified or untrusted build: sign the remote's descriptor (`NF_COMPONENTS_SIGNING_KEY`, `publicKeys` in the host) or pin its builds, and pass the descriptor from `getComponentDescriptor` unchanged:

  ```ts
  // federation.ts
  components: { ssr: { publicKeys: [/* the remote's public JWK */] } }
  ```

- Node.js too old: run the host on Node.js 20.16 or newer.
- Nested remotes (refused): expose the nested components from their own remote and use them from the host directly.
- Mixed-router hosts: use a Module Federation plugin version the library lists.
- Stale share cache: restart the dev server.
- To turn server rendering off without a warning, set `components.ssr: false`.

## Useful Links

- [Remote components: integrity](../guides/remote-components/security.mdx#integrity-server-rendering)
- [Remote components: mixed-router hosts](../guides/remote-components/security.mdx#mixed-router-hosts)
