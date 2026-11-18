# Identity: per-user islands

A **private island** renders for the signed-in user. The host signs a short-lived token for one
remote, the remote verifies it, and the island reads the user with `getIdentity()`.

Runnable example: [examples/next-app-router](../../examples/next-app-router) (host) and
[examples/vite-remote](../../examples/vite-remote) (the private `MyOrders` island). With several remotes and a role claim:
[examples/advanced](../../examples/advanced/README.md) (one sign-in, private islands from two
remotes, an admin-only island).

## How it works

- The host signs tokens with ES256. The token's audience (`aud`) is the remote's name. The default
  lifetime is 300 seconds (`identity.ttlSeconds`, at most 900: remotes refuse older tokens, so a
  larger value is `NF-002`).
- On a server render, the host mints the token on the server and sends it only in the request to the
  remote. Tokens never appear in the HTML, the RSC payload, `__NEXT_DATA__` or `/_next/data`. The
  page carries only the token endpoint and an opaque per-user marker.
- In the browser, the island asks the host's same-origin token endpoint for a fresh token.
- The host publishes its public keys as a JWKS. The remote fetches them from the URL you list in its
  `issuers` map, never from a URL in the token.
- If the JWKS cannot be fetched, the remote answers `503` (`NF-015`), not `401`. An outage is not an
  invalid token.

## Host setup (App Router)

The federation config is its own file with no Next.js imports (`nf-types` loads it with plain Node;
see [Getting started](getting-started-app-router.md#3-define-the-federation)). Read the secrets from
the environment:

```ts
// lib/federation.config.ts
import { defineFederation } from '@next-federation/core'

export const federation = defineFederation({
  remotes: { shop: { origin: process.env.SHOP_ORIGIN ?? 'https://shop.example.com' } },
  identity: {
    // Must equal the key in the remote's `issuers` map, character for character.
    issuer: process.env.NF_ISSUER ?? 'https://www.example.com',
    signingKeys: process.env.NF_SIGNING_KEY!,
  },
})
```

```ts
// lib/federation.ts
import 'server-only'
import { createFederationRoutes } from '@next-federation/next/routes'
import { createIslands } from '@next-federation/next/server'
import type { AppIdentity } from '@next-federation/next/server'
import { federation } from './federation.config'

export { federation }

const getIdentity: AppIdentity = ({ cookies }) => {
  const sub = cookies.get('session-user')?.value
  return sub ? { sub } : null
}

export const { RemoteIsland } = createIslands(federation, { getIdentity })
export const routes = createFederationRoutes(federation, { getIdentity })
```

```ts
// app/api/next-federation/[...nf]/route.ts
import { routes } from '../../../../lib/federation'

export const { GET, POST } = routes
```

### What `getIdentity` returns

`getIdentity` returns `{ sub, claims? }` for a signed-in user, or `null` for an anonymous one:

```ts
const getIdentity: AppIdentity = async ({ cookies }) => {
  const session = await readSession(cookies.get('session')?.value)
  if (!session) return null
  return {
    sub: session.userId, // required, a non-empty string
    claims: { name: session.name, email: session.email, roles: session.roles },
  }
}
```

- `sub` becomes the token's `sub`. Each key of `claims` becomes a claim of its own, at the top level
  of the token (not under a `claims` key). Keep claims small and JSON-serializable: the token
  travels in an `Authorization` header.
- `iss`, `aud`, `sub`, `exp`, `iat`, `nbf` and `jti` are reserved: the library sets them, and a
  `claims` object that sets one is refused with `NF-002`.
- `getIdentity` should not throw. Catch your session lookup's errors and return `null`: the visitor
  is then treated as anonymous (`errorFallback`).

On the remote, `getIdentity()` (`@next-federation/island`) returns the whole verified payload:
`sub`, your claims, and `iss`, `aud`, `iat` and `exp`. For the example above:

```ts
{ sub: 'u_123', name: 'Ada', email: 'ada@example.com', roles: ['admin'],
  iss: 'https://www.example.com', aud: 'shop', iat: 1763380000, exp: 1763380120 }
```

**`sub` is unique per issuer only.** Two hosts can both have a user `42`. A remote that trusts more
than one host (several entries in `issuers`) should key its data by `(iss, sub)`, not by `sub`
alone. Decide permissions from the remote's own data for that key; treat claims such as `roles` as
display hints unless the remote trusts that host to grant them.

Create this file yourself: the library cannot add routes to your `app/`. It serves
`GET <routesPath>/jwks` and `POST <routesPath>/token?aud=<remote>`. `routesPath` defaults to
`/api/next-federation`.

### Generate a signing key

Save this as `scripts/generate-key.mjs` in the host project (it needs `@next-federation/core`
installed) and run it once:

```js
// scripts/generate-key.mjs
import { generateSigningKey } from '@next-federation/core/identity'

console.log(await generateSigningKey('2026-11'))
```

```sh
node scripts/generate-key.mjs
```

It prints one private JWK as JSON. Put it in `.env.local` (git-ignored) in single quotes, and in your
host's secret store for production:

```sh
# .env.local
NF_SIGNING_KEY='{"kty":"EC","x":"...","y":"...","crv":"P-256","d":"...","kid":"2026-11","alg":"ES256"}'
NF_ISSUER='http://localhost:3000'
```

Keep the key secret. `signingKeys` takes private ES256 JWKs as JSON strings, each with a `kid`. Call
`await validateIdentity(federation)` from `instrumentation.ts` to fail at boot on a malformed key:

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { validateIdentity } = await import('@next-federation/core/identity')
  const { federation } = await import('./lib/federation.config')
  await validateIdentity(federation)
}
```

### Sign in and sign out

`getIdentity` above reads a cookie, so signing in is whatever sets that cookie. The routes below are
a minimal demo of the shape. They trust the posted user name: replace the bodies with your real
session login.

Redirect with a relative `Location`. Next normalizes `req.url` to `localhost`, so
`NextResponse.redirect(new URL('/me', req.url))` sends a host started with `-H 127.0.0.1` to the
wrong origin.

```ts
// app/api/login/route.ts (demo only)
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const user = String(form.get('user') ?? 'alice')
  // A relative redirect (with a basePath: `${basePath}/me`).
  const res = new NextResponse(null, { status: 303, headers: { Location: '/me' } })
  res.cookies.set('session-user', user, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
  return res
}
```

```ts
// app/api/logout/route.ts
export function POST() {
  const res = Response.json({ ok: true })
  res.headers.append('set-cookie', 'session-user=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
  return res
}
```

The `Secure` flag is on in production only, so local `next dev` over plain `http` is unaffected. A
production build served over `http://localhost` (`next start`) works in Chromium and Firefox, which
treat localhost as secure. Safari may drop `Secure` cookies on plain `http`; this was not tested
there, so use `https` for local production runs in Safari.

On sign-out the browser must also forget the island tokens it holds:
`clearIslandTokens()` from `@next-federation/react`.

```tsx
// app/sign-out-button.tsx
'use client'
import { clearIslandTokens } from '@next-federation/react'
import { useRouter } from 'next/navigation'

export function SignOutButton() {
  const router = useRouter()
  return (
    <button
      onClick={async () => {
        await fetch('/api/logout', { method: 'POST' }) // with a basePath: `${basePath}/api/logout`
        clearIslandTokens()
        router.refresh()
      }}
    >
      Sign out
    </button>
  )
}
```

After sign-out on an App Router host in production:

- **Islands:** the next render of a private island has no user, makes no request to the remote, and
  shows `errorFallback`. Until the page re-renders (`router.refresh()` or a navigation), the island
  already on screen keeps its HTML. A page with only public islands never contained user data, so
  nothing changes there.
- **Server Actions:** a public island fetches a token for whoever is signed in each time an action
  runs, so after sign-out the action goes out with no `Authorization` header. `getIdentity()` is
  `null` in it, and a `requireIdentity` action is refused with `401` [`NF-014`](../errors/invalid-token.md).
  A private island caches its token in memory until about 30 seconds before it expires:
  `clearIslandTokens()` drops it at once.
- **Tokens already issued** stay valid at the remote until they expire (300 seconds by default;
  there is no revocation list). Keep `identity.ttlSeconds` short if that matters to you.

## Host setup (Pages Router)

```ts
// lib/federation.ts (the config is in lib/federation.config.ts, as above)
import { createPagesIslands } from '@next-federation/next/pages/server'
import type { PagesIdentity } from '@next-federation/next/pages/server'
import { federation } from './federation.config'

export { federation }

export const getIdentity: PagesIdentity = (req) => {
  const sub = req.cookies['session-user']
  return sub ? { sub } : null
}

export const { getIslandProps } = createPagesIslands(federation, { getIdentity })
```

```ts
// pages/api/next-federation/[...nf].ts
import { createFederationApiHandler } from '@next-federation/next/pages/server'
import { federation, getIdentity } from '../../../lib/federation'

export default createFederationApiHandler(federation, { getIdentity })
```

`getIdentity` takes the request. Sign-in and sign-out are API routes that set and clear the same
cookie (`res.setHeader('Set-Cookie', ...)`). Call `clearIslandTokens()` on sign-out as above. Use private
islands from `getServerSideProps` only. A private island in `getStaticProps` throws `NF-002`,
because there is no request to read the user from.

## Remote setup

List the host's issuer and JWKS URL in the `issuers` option of `nextFederationIslands`, and mark the
island `private: true`:

```ts
issuers: { 'https://www.example.com': 'https://www.example.com/api/next-federation/jwks' },
islands: { MyOrders: { entry: './src/islands/MyOrders.tsx', private: true } },
```

The token's `iss` must equal the map key exactly, and the host signs `identity.issuer`
literally. `https://www.example.com` and `https://www.example.com/` are different issuers, and so
are `http://localhost:3000` and `http://127.0.0.1:3000`. With a `basePath`, the issuer includes it, and
so does the JWKS URL:

| | Host config | Remote `issuers` key | JWKS URL |
| --- | --- | --- | --- |
| No `basePath` | `issuer: 'https://www.example.com'` | `'https://www.example.com'` | `https://www.example.com/api/next-federation/jwks` |
| `basePath: '/app'` | `issuer: 'https://www.example.com/app'` | `'https://www.example.com/app'` | `https://www.example.com/app/api/next-federation/jwks` |

The remote's `hosts` list holds the host's **origin** (`'https://www.example.com'`, no `basePath`).

A remote knows its hosts and issuers at build time. For every new host origin (a preview
deployment, a staging domain, a new dev port) add it to `hosts` and `issuers` and rebuild the remote
([Writing an island remote](writing-an-island-remote.md#host-origins-and-issuers-must-match-exactly)).
In development, set `NF_ISSUER` (as in the `.env.local` above) to the origin the host actually runs
on. A mismatch is `401` [`NF-016`](../errors/issuer-not-allowed.md).

Use `https`. Plain `http` is refused (`NF-002`) for any host other than `localhost`,
`127.0.0.0/8` and `[::1]`, unless `NODE_ENV` is `development` or `test`. This covers the host's
`identity.issuer` and remote origins, and the remote's `issuers` map (issuer and JWKS URL). If you
really need plain `http` elsewhere, for example behind a TLS-terminating proxy on a private network, set
`allowInsecureHttp: true` (in `defineFederation`, `nextFederationIslands`, `nextFederationComponents`
or `createIdentityVerifier`). It logs a warning once per process.

## Behaviour to expect

- An anonymous visitor on a private island makes no remote request and sees `errorFallback`.
- A private island makes an App Router route dynamic unless `cacheComponents` is on, where it becomes
  a dynamic hole.
- Tokens older than 15 minutes are rejected by the remote (`maxAgeSeconds`, default 900), and the
  clock tolerance is 30 seconds.
- `aud` scopes a token to one remote's **server**. Island scripts run in the host origin, so any
  island on the page can ask the token endpoint for a token for any configured remote. `aud` is not
  isolation between remotes in the browser. Only configure remotes you would trust with that.
- The token never appears in HTML, RSC payloads or page props, in production and in `next dev`
  with Next's default dev source maps. The exception is a library linked from outside
  `node_modules` (developing next-federation itself) under `next dev`: `NF-037`, which also warns
  when `next dev` runs with source maps disabled
  ([Limits](limits.md#next-dev-and-linked-installs)).

## Key rotation

Remotes cache the JWKS for up to 10 minutes, and an unknown `kid` triggers at most one refetch per
30 seconds. To rotate without rejected tokens:

1. Add the new key to `identity.signingKeys` as a **non-first** entry. It is published in the JWKS but
   does not sign yet.
2. Wait at least 10 minutes. That covers the 30-second JWKS cooldown and the caches.
3. Move the new key to the first position. It now signs.
4. Keep the old key published until its last token has expired (at least the token lifetime), then
   remove it.

Rotation changes identity keys. The opaque per-user marker is derived from the first signing key, so
it changes for every user at step 3. Anything cached per marker is refreshed once.

Related errors: [NF-013](../errors/identity-not-configured.md), [NF-014](../errors/invalid-token.md),
[NF-015](../errors/jwks-unavailable.md), [NF-016](../errors/issuer-not-allowed.md).
