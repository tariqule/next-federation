import react from '@vitejs/plugin-react'
import rsc from '@vitejs/plugin-rsc'
import { defineConfig } from 'vite'

const PORT = Number(process.env.PORT ?? 4100)
const ORIGIN = `http://127.0.0.1:${PORT}`

export default defineConfig({
  // plugin-rsc requires an absolute base for RSC asset URLs (design §2, §6 build pinning).
  base: `${ORIGIN}/`,
  plugins: [
    react(),
    rsc({
      entries: {
        rsc: './src/entry.rsc.tsx',
        ssr: './src/entry.ssr.tsx',
        client: './src/bootstrap.tsx',
      },
      // Islands must not emit hoistable <link precedence> tags; CSS URLs go in the envelope instead.
      rscCssTransform: false,
    }),
  ],
  define: {
    'import.meta.env.NF_REMOTE': JSON.stringify(process.env.NF_REMOTE ?? 'a'),
    'import.meta.env.NF_ORIGIN': JSON.stringify(ORIGIN),
  },
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
    cors: { origin: [/^http:\/\/localhost:\d+$/] },
  },
})
