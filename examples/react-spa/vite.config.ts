import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const server = { host: 'localhost', port: 3303, strictPort: true }

export default defineConfig({
  plugins: [react()],
  // One React for the app and @next-federation/react.
  resolve: { dedupe: ['react', 'react-dom'] },
  server,
  preview: server,
})
