import { nextFederationIslands } from '@next-federation/vite'
import { defineConfig } from 'vite'

// The PDP remote (product detail page). Islands: the product detail, gallery and recommendations.
// Locally it runs on 127.0.0.1:13401 and the hosts on localhost, so a host and a
// remote are different sites, as in production. Set the URLs with
// environment variables in a deployment.
const STOREFRONT = new URL(
  process.env.STOREFRONT_ORIGIN ?? 'http://localhost:13410'
).origin
const BASE = process.env.PDP_ORIGIN ?? 'http://127.0.0.1:13401'

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
      name: 'pdp',
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
        ProductDetail: './src/islands/ProductDetail.tsx',
        Recommendations: './src/islands/Recommendations.tsx',
        // Private: rendered per user from a token the host signs for `pdp`.
        ForYou: { entry: './src/islands/ForYou.tsx', private: true },
      },
    }),
    server: { host: '127.0.0.1', port: 13401, strictPort: true },
  }
})
