import { nextFederationIslands } from '@next-federation/vite'
import { defineConfig } from 'vite'

// The hosts' origins: the App Router host, the Pages Router host (basePath
// /shop) and the SPA. Locally they run on `localhost`, ports 3301-3303, and
// this remote on 127.0.0.1:3300, so hosts and remote are different sites, as
// in production. A deployment sets each variable to the host's URL; on
// Vercel a missing one fails the build instead of falling back to localhost.
function origin(name: string, local: string): string {
  const value = process.env[name]
  if (!value && process.env.VERCEL) {
    throw new Error(`${name} is not set: set it on the Vercel project`)
  }
  return new URL(value || local).origin
}
const APP_ROUTER = origin('APP_ROUTER_ORIGIN', 'http://localhost:3301')
const PAGES_ROUTER = origin('PAGES_ROUTER_ORIGIN', 'http://localhost:3302')
const SPA = origin('SPA_ORIGIN', 'http://localhost:3303')

// On Vercel (scripts/vercel-build.ts sets NF_VERCEL=1), the remote is served
// from its public origin: NF_PUBLIC_ORIGIN if set, else the production domain
// Vercel sets, without the scheme, as VERCEL_PROJECT_PRODUCTION_URL (which
// may name another of the project's domains). Never use VERCEL_URL:
// generated deployment URLs are behind Vercel's login.
const VERCEL = process.env.NF_VERCEL === '1'
function base(): string {
  if (!VERCEL) return 'http://127.0.0.1:3300/'
  const publicOrigin = process.env.NF_PUBLIC_ORIGIN
  if (publicOrigin) {
    // An https origin, as https://shop.example.com: no path, no trailing slash.
    const url = URL.canParse(publicOrigin) ? new URL(publicOrigin) : null
    if (url?.protocol !== 'https:' || url.origin !== publicOrigin) {
      throw new Error(
        `NF_PUBLIC_ORIGIN must be an https origin, without a trailing slash: ${publicOrigin}`
      )
    }
    return `${publicOrigin}/`
  }
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (!domain) {
    throw new Error(
      'NF_VERCEL=1 needs NF_PUBLIC_ORIGIN or VERCEL_PROJECT_PRODUCTION_URL'
    )
  }
  return `https://${domain}/`
}

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
      base: base(),
      buildId,
      // On Vercel, one build per deployment, in dist/vercel/<buildId>.
      outDir: VERCEL ? 'dist/vercel' : 'dist',
      hosts: [APP_ROUTER, PAGES_ROUTER, SPA],
      // Hosts that sign identity tokens (private islands): issuer -> JWKS URL.
      // The Pages Router host has a basePath, so its issuer includes it.
      issuers: {
        [APP_ROUTER]: `${APP_ROUTER}/api/next-federation/jwks`,
        [`${PAGES_ROUTER}/shop`]: `${PAGES_ROUTER}/shop/api/next-federation/jwks`,
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
