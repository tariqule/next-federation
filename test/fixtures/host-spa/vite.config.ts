// A client-side React host: fetches island envelopes in the browser and
// mounts them with @next-federation/react.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { laneName, lanePort } from '../../e2e/lane.ts'

// NF_LANE (see test/e2e/lane.ts): the lane's port, build and cache folders.
const LANE = laneName()
const PORT = lanePort(4200)

export default defineConfig({
  plugins: [react()],
  // One React for the host and @next-federation/react.
  resolve: { dedupe: ['react', 'react-dom'] },
  ...(LANE && {
    cacheDir: `node_modules/.vite-${LANE}`,
    build: { outDir: `dist/${LANE}` },
  }),
  server: { host: 'localhost', port: PORT, strictPort: true },
  preview: { host: 'localhost', port: PORT, strictPort: true },
})
