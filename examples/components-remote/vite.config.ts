import { nextFederationComponents } from '@next-federation/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // The plugin signs each build's descriptor with NF_COMPONENTS_SIGNING_KEY
  // from the build environment (in CI: a secret). Locally it comes from
  // .env.local, written by `pnpm examples:keys`; Vite does not put .env
  // values on process.env, so copy it there.
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
      base: 'http://127.0.0.1:3304/',
      exposes: { './CartButton': './src/CartButton.tsx' },
      // Host-provided (never bundled): the remote reads the host's cart.
      shared: ['example-cart-context'],
    }),
  }
})
