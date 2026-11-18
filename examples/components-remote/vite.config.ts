import { nextFederationComponents } from '@next-federation/vite'
import { defineConfig, loadEnv } from 'vite'

// On Vercel (scripts/vercel-build.ts sets NF_VERCEL=1), the remote is served
// from its public origin: NF_PUBLIC_ORIGIN if set, else the production domain
// Vercel sets, without the scheme, as VERCEL_PROJECT_PRODUCTION_URL (which
// may name another of the project's domains). Never use VERCEL_URL:
// generated deployment URLs are behind Vercel's login.
const VERCEL = process.env.NF_VERCEL === '1'
function base(): string {
  if (!VERCEL) return 'http://127.0.0.1:3304/'
  const publicOrigin = process.env.NF_PUBLIC_ORIGIN
  if (publicOrigin) {
    // An https origin, as https://cart.example.com: no path, no trailing slash.
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

export default defineConfig(({ mode }) => {
  // The plugin signs each build's descriptor with NF_COMPONENTS_SIGNING_KEY
  // from the build environment (in CI or on Vercel: a secret). Locally it
  // comes from .env.local, written by `pnpm examples:keys`; Vite does not put
  // .env values on process.env, so copy it there.
  process.env.NF_COMPONENTS_SIGNING_KEY ??= loadEnv(
    mode,
    import.meta.dirname,
    'NF_'
  ).NF_COMPONENTS_SIGNING_KEY
  // One build id (NF_BUILD_ID, else the build time) for every part of the
  // build: the plugin's server build loads this file again.
  process.env.NF_BUILD_ID ??= new Date().toISOString().replace(/[:.]/g, '-')
  return {
    plugins: nextFederationComponents({
      name: 'cart',
      base: base(),
      // On Vercel, one build per deployment, in dist/vercel/<buildId>.
      outDir: VERCEL ? 'dist/vercel' : 'dist',
      exposes: { './CartButton': './src/CartButton.tsx' },
      // Host-provided (never bundled): the remote reads the host's cart.
      shared: ['example-cart-context'],
    }),
  }
})
