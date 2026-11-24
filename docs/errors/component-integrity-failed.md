# NF-027: Remote component server code failed its integrity check

## Why This Error Occurred

The host could not verify a remote component build, so it did not run its server code. The component renders in the browser only. Server rendering runs the remote's code in the host's process, so the host only evaluates code that matches a descriptor it trusts.

## Possible Ways to Fix It

- Signed build: build the remote with `NF_COMPONENTS_SIGNING_KEY` set to the private key whose public half is in the host's `components.ssr.publicKeys`. Keep the old key listed while builds signed with it are live.
- Pinned build: copy the `digest` from `nf-components.json` into `components.ssr.pinned`.
- Re-deploy the build unchanged if a proxy, CDN or partial upload altered its files.

```sh
NF_COMPONENTS_SIGNING_KEY="$(cat signing-key.pem)" vite build
```

## Useful Links

- [Remote components: integrity](../guides/remote-components.md#integrity-server-rendering)
