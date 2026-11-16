# Identity: per-user islands

A **private island** renders for the signed-in user. The host signs a short-lived token for one
remote, the remote verifies it, and the island reads the user with `getIdentity()`.

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

```ts
// lib/federation.ts
import 'server-only'
import { defineFederation } from '@next-federation/core'
import { createFederationRoutes } from '@next-federation/next/routes'
import { createIslands } from '@next-federation/next/server'
import type { AppIdentity } from '@next-federation/next/server'

export const federation = defineFederation({
  remotes: { shop: { origin: 'https://shop.example.com' } },
  identity: {
    issuer: 'https://www.example.com',
    signingKeys: process.env.NF_SIGNING_KEY!,
  },
})

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

The library cannot add routes to your `app/`, so you create this file. It serves
`GET <routesPath>/jwks` and `POST <routesPath>/token?aud=<remote>`. `routesPath` defaults to
`/api/next-federation`.

Generate a key once and keep it secret:

```ts
import { generateSigningKey } from '@next-federation/core/identity'

console.log(await generateSigningKey('2026-11'))
```

`signingKeys` takes private ES256 JWKs as JSON strings, each with a `kid`. Call
`await validateIdentity(federation)` from `instrumentation.ts` to fail at boot on a malformed key.

## Host setup (Pages Router)

```ts
// pages/api/next-federation/[...nf].ts
import { createFederationApiHandler } from '@next-federation/next/pages/server'
import { federation, getIdentity } from '../../../lib/federation'

export default createFederationApiHandler(federation, { getIdentity })
```

`getIdentity` takes the request: `(req) => (req.cookies.session ? { sub } : null)`. Use private
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
literally. `https://www.example.com` and `https://www.example.com/` are different issuers. With a
`basePath`, the issuer includes it, and so does the JWKS URL.

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

Errors: [NF-013](../errors/identity-not-configured.md), [NF-014](../errors/invalid-token.md),
[NF-015](../errors/jwks-unavailable.md), [NF-016](../errors/issuer-not-allowed.md).
