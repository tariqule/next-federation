# NF-039: Remote component deferred to request time

## Why This Error Occurred

An App Router page with `cacheComponents` was regenerated before this server process had loaded the remote components' build. The components render per request on the server instead, so visitors still get server markup. It is logged once per build, as a warning.

## Possible Ways to Fix It

- Do nothing. It resolves once the process has loaded the build, and the page returns to the static cache on its next regeneration (`components.revalidate`, 60 s by default).
- To skip server rendering for a remote, set `components.ssr: false`:

  ```ts
  // federation.ts
  remotes: {
    ui: { origin: 'https://ui.example.com', components: { ssr: false } },
  }
  ```

## Useful Links

- [Remote components: runtime behaviour](../guides/remote-components.md#runtime-behaviour)
- [NF-028: Remote component rendered in the browser only](component-browser-only.md)
