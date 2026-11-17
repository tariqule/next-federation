# Content Security Policy

A host loads each remote's JavaScript and CSS and calls its server from the browser. Add every remote
origin to three directives:

| Directive     | Why                                                          |
| ------------- | ------------------------------------------------------------ |
| `script-src`  | The island bootstrap and its chunks are loaded from the remote. |
| `connect-src` | Browser requests to the remote (SPA envelopes, island data). |
| `style-src`   | Island stylesheets are linked from the remote.               |

The remote origins are only half of a working policy: Next.js itself needs more than `'self'` to run.
This policy is what the validated mixed-router host sends (App Router and Pages Router routes,
`basePath: '/mixed'`, islands and remote components from two remotes, checked in `next dev` and
`next start`). Put it in `next.config.ts`:

```ts
// next.config.ts
import type { NextConfig } from 'next'
import { withNextFederation } from '@next-federation/next/config'

// Every remote origin: islands remotes and components remotes alike.
const remotes = ['https://shop.example.com', 'https://widgets.example.com'].join(' ')
const dev = process.env.NODE_ENV !== 'production'

const csp = [
  "default-src 'self'",
  // Next.js writes inline bootstrap scripts. Without a nonce setup they need 'unsafe-inline'.
  // `next dev` also evaluates code (React's debugging features), so it needs 'unsafe-eval'.
  `script-src 'self' 'unsafe-inline' ${dev ? "'unsafe-eval' " : ''}${remotes}`,
  // `next dev` talks to its server over a WebSocket (HMR).
  `connect-src 'self' ${remotes}${dev ? ' ws:' : ''}`,
  `style-src 'self' 'unsafe-inline' ${remotes}`,
  "img-src 'self' data:",
].join('; ')

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: csp }] }]
  },
}

export default withNextFederation(nextConfig)
```

`headers()` sources are prefixed with `basePath` for you. What each part is for:

- `'unsafe-inline'` in `script-src`: Next's inline bootstrap and RSC payload scripts. Without it,
  the page does not hydrate. Nonces are the alternative, below.
- `'unsafe-eval'` and `ws:`: development only. The production policy has neither.
- `'unsafe-inline'` in `style-src`: Next and React emit inline styles.
- Add the remote origin to `img-src` and `font-src` if its islands load images or fonts from it
  (not part of the validated policy).

A remote at `https://shop.example.com` contributes this to the three directives:

```
script-src 'self' https://shop.example.com;
connect-src 'self' https://shop.example.com;
style-src 'self' https://shop.example.com;
```

If a remote serves assets from another origin (a CDN), add that origin too, and list it in
`assetOrigins` for that remote in the host's `defineFederation` config. Without it the host refuses
the envelope (`NF-005`).

Remote components need the remote origin in `script-src` (its `remoteEntry.js` and chunks
are ES modules, also `modulepreload`ed by a server render), `style-src` (the stylesheets of its
exposed modules) and `connect-src` (the browser fetches `mf-manifest.json`; an SPA also fetches
`/_nf/components.json`). See [Remote components](remote-components.md).

## `'strict-dynamic'`

With `'strict-dynamic'`, the island bootstrap is loaded by host script, so it is trusted
transitively. `'strict-dynamic'` covers scripts only: `connect-src` and `style-src` still need the
remote origin. Keep the origin in `script-src` as a fallback for browsers without `'strict-dynamic'`.

## Nonces

Replacing `'unsafe-inline'` with a per-request nonce is the stricter option, and Next.js supports
it: you generate the nonce for each request and send it in the `Content-Security-Policy` header
(Next's CSP guide shows this in `proxy.ts`, formerly `middleware.ts`), and Next adds it to its own
scripts. Next's guide notes that a nonce makes every page render per request, so static and
prerendered pages are given up.

What next-federation does under a nonce policy, from the code:

- Island HTML contains no scripts. The payloads embedded for hydration travel inside Next.js's own
  nonce'd scripts, so no nonce plumbing is needed for them.
- The library does not read request headers to find a nonce, because that would make renders
  dynamic.
- The island bootstrap and remote component chunks are loaded from the remote's origin. With
  `'strict-dynamic'` they are trusted through the nonce'd script that loads them (see above);
  without it, the remote origin stays in `script-src`.

**Not validated.** The validation of this guide ran the `'unsafe-inline'` policy above only. A
nonce-based policy has no test in this repository, so try it in a preview deployment and watch the
console for CSP violations before you rely on it.

## Related

The remote must also allow your origin in its `hosts` option (CORS and `Origin` check). A request from
an unlisted origin is answered `403` with `NF-022` ([Origin not allowed](../errors/origin-not-allowed.md)).
