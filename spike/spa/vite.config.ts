import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: 'http://localhost:4200/',
  plugins: [
    react(),
    federation({
      name: 'spa',
      filename: 'remoteEntry.js',
      manifest: true,
      dts: false,
      exposes: { './CartButton': './src/CartButton.tsx' },
      // The SPA is also a standalone app, so it keeps a React fallback; a host that registers its
      // own React wins as the singleton (design §7).
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
        'react/jsx-runtime': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  server: { host: 'localhost', port: 4200, strictPort: true, cors: true },
})
