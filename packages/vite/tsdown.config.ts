import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  unbundle: true,
  dts: true,
  format: 'esm',
  platform: 'node',
  fixedExtension: false,
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  // Resolved by the remote's own Vite build, where these modules exist.
  external: [/^virtual:/],
})
