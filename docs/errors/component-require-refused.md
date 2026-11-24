# NF-030: Remote component server code required a module the host does not provide

## Why This Error Occurred

A remote build's server code called `require()` for a module the host does not hand out. The host resolves only the remote's own files and `@module-federation/runtime`, so the component renders in the browser only. Remote components run on the host's React, and a second copy would fail with "Invalid hook call".

## Possible Ways to Fix It

- Build the remote with `nextFederationComponents`, which treats React, `react-dom` and `react/jsx-runtime` as host-provided.
- List every other package the host owns in the remote's `shared` option and in the host's `createRemoteComponent({ shared })`:

  ```ts
  shared: { '@acme/ui': { version: '2.4.0', module: AcmeUi } }
  ```

- Leave packages only the remote uses out of `shared`. They are bundled into its chunks.

## Useful Links

- [Remote components: sharing modules](../guides/remote-components/sharing-modules.mdx)
