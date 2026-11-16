import { nextFederationIslands } from '@next-federation/vite'
import { defineConfig } from 'vite'

// Example ports: this remote 3300, the App Router host 3301, the Pages Router
// host 3302 (basePath /shop), the SPA 3303. Hosts are opened as `localhost`
// and remotes as `127.0.0.1`, so they are different sites, as in production.
const HOSTS = [3301, 3302, 3303].map((port) => `http://localhost:${port}`)

export default defineConfig(({ command }) => {
  // One id per build: NF_BUILD_ID, else the build time. The islands print it,
  // so you can see which build rendered them after a redeploy.
  const buildId =
    command === 'serve'
      ? 'dev'
      : (process.env.NF_BUILD_ID ??= new Date()
          .toISOString()
          .replace(/[:.]/g, '-'))
  return {
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    plugins: nextFederationIslands({
      name: 'shop',
      base: 'http://127.0.0.1:3300/',
      buildId,
      hosts: HOSTS,
      // Hosts that sign identity tokens (private islands): issuer -> JWKS URL.
      // The Pages Router host has a basePath, so its issuer includes it.
      issuers: {
        'http://localhost:3301':
          'http://localhost:3301/api/next-federation/jwks',
        'http://localhost:3302/shop':
          'http://localhost:3302/shop/api/next-federation/jwks',
      },
      islands: {
        ProductPanel: './src/islands/ProductPanel.tsx',
        Links: './src/islands/Links.tsx',
        MyOrders: { entry: './src/islands/MyOrders.tsx', private: true },
      },
    }),
    server: { host: '127.0.0.1', port: 3300, strictPort: true },
  }
})
