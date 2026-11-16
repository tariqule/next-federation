# Content Security Policy

A host loads each remote's JavaScript and CSS and calls its server from the browser. Add every remote
origin to three directives:

| Directive     | Why                                                          |
| ------------- | ------------------------------------------------------------ |
| `script-src`  | The island bootstrap and its chunks are loaded from the remote. |
| `connect-src` | Browser requests to the remote (SPA envelopes, island data). |
| `style-src`   | Island stylesheets are linked from the remote.               |

Example for a remote at `https://shop.example.com`:

```
script-src 'self' https://shop.example.com;
connect-src 'self' https://shop.example.com;
style-src 'self' https://shop.example.com;
```

If a remote serves assets from another origin (a CDN), add that origin too, and list it in
`assetOrigins` for that remote in the host's `defineFederation` config. Without it the host refuses
the envelope (`NF-005`).

Client components (Mode A) need the remote origin in `script-src` (its `remoteEntry.js` and chunks
are ES modules) and `connect-src` (the browser fetches `mf-manifest.json`; an SPA also fetches
`/_nf/components.json`). See [Client components](client-components.md).

## `'strict-dynamic'`

With `'strict-dynamic'`, the island bootstrap is loaded by host script, so it is trusted
transitively. `'strict-dynamic'` covers scripts only: `connect-src` and `style-src` still need the
remote origin. Keep the origin in `script-src` as a fallback for browsers without `'strict-dynamic'`.

## Nonces

Island HTML contains no scripts. Embedded payloads travel inside Next.js's own nonce'd scripts, so no
nonce plumbing is needed for them. The library does not read request headers to find a nonce, because
that would make renders dynamic.

## Related

The remote must also allow your origin in its `hosts` option (CORS and `Origin` check). A request from
an unlisted origin is answered `403` with `NF-022` ([Origin not allowed](../errors/origin-not-allowed.md)).
