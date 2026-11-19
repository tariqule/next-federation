import { nextFederationIslands } from '@next-federation/vite'
import { defineConfig } from 'vite'

// The Account remote (orders, profile and the admin inventory). Islands: AccountBadge, Profile, Orders and Inventory, all private, with Server Actions.
// Locally it runs on 127.0.0.1:13403 and the hosts on localhost, so a host and a
// remote are different sites, as in production. Set the URLs with
// environment variables in a deployment.
const STOREFRONT = new URL(
  process.env.STOREFRONT_ORIGIN ?? 'http://localhost:13410'
).origin
const BASE = process.env.ACCOUNT_ORIGIN ?? 'http://127.0.0.1:13403'

export default defineConfig(({ command }) => {
  // One id per build (NF_BUILD_ID, else the build time). The islands print
  // it, so you can see which build rendered them after a redeploy.
  const buildId =
    command === 'serve'
      ? 'dev'
      : (process.env.NF_BUILD_ID ??= new Date()
          .toISOString()
          .replace(/[:.]/g, '-'))
  return {
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    plugins: nextFederationIslands({
      name: 'account',
      base: `${BASE}/`,
      buildId,
      // Browser origins allowed to embed these islands (CORS allowlist).
      // Private islands need a host server that signs tokens.
      hosts: [STOREFRONT],
      // Hosts whose identity tokens this remote accepts: issuer -> JWKS URL.
      // The storefront has basePath /store, so its issuer includes it.
      issuers: {
        [`${STOREFRONT}/store`]: `${STOREFRONT}/store/api/next-federation/jwks`,
      },
      islands: {
        AccountBadge: {
          entry: './src/islands/AccountBadge.tsx',
          private: true,
        },
        Profile: { entry: './src/islands/Profile.tsx', private: true },
        Orders: { entry: './src/islands/Orders.tsx', private: true },
        Inventory: { entry: './src/islands/Inventory.tsx', private: true },
      },
      // Deny by default: every Server Action needs a verified token (401
      // NF-014 otherwise), on top of requireIdentity() in src/actions.ts.
      actions: { requireIdentity: true },
    }),
    server: { host: '127.0.0.1', port: 13403, strictPort: true },
  }
})
