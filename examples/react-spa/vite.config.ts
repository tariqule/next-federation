import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const server = { host: 'localhost', port: 3303, strictPort: true }

export default defineConfig(({ mode }) => {
  // The remotes' URLs are compiled into the bundle (src/federation.ts), with
  // the local ports as defaults. On Vercel a missing one fails the build
  // instead of shipping a bundle that points at localhost.
  if (process.env.VERCEL) {
    const env = loadEnv(mode, import.meta.dirname, 'VITE_')
    for (const name of ['VITE_SHOP_ORIGIN', 'VITE_CART_ORIGIN']) {
      if (!env[name]) {
        throw new Error(`${name} is not set: set it on the Vercel project`)
      }
    }
  }
  return {
    plugins: [react()],
    // One React for the app and @next-federation/react.
    resolve: { dedupe: ['react', 'react-dom'] },
    server,
    preview: server,
  }
})
