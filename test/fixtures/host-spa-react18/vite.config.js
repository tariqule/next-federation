// A client-side React 18 host (react18.spec.ts): a copy of this folder with
// React 18.3.1 and the packed next-federation tarballs in a real
// node_modules (test/e2e/fixtures/installed-host.ts, which passes --port).
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // One React for the host and @next-federation/react.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { host: 'localhost', strictPort: true },
  preview: { host: 'localhost', strictPort: true },
})
