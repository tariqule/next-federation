import { nextFederationIslands } from '@next-federation/vite'
import { defineConfig } from 'vite'

// The CDP remote (category page). Islands: the product grid and its filters.
// Locally it runs on 127.0.0.1:13400 and the hosts on localhost, so a host and a
// remote are different sites, as in production. Set the URLs with
// environment variables in a deployment.
const STOREFRONT = new URL(
  process.env.STOREFRONT_ORIGIN ?? 'http://localhost:13410'
).origin
const BASE = process.env.CDP_ORIGIN ?? 'http://127.0.0.1:13400'

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
      name: 'cdp',
      base: `${BASE}/`,
      buildId,
      // Browser origins allowed to embed these islands (CORS allowlist).
      hosts: [STOREFRONT],
      // Hosts whose identity tokens this remote accepts: issuer -> JWKS URL.
      // The storefront has basePath /store, so its issuer includes it.
      issuers: {
        [`${STOREFRONT}/store`]: `${STOREFRONT}/store/api/next-federation/jwks`,
      },
      islands: {
        ProductGrid: './src/islands/ProductGrid.tsx',
        CategoryNav: './src/islands/CategoryNav.tsx',
      },
    }),
    server: { host: '127.0.0.1', port: 13400, strictPort: true },
  }
})
