import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/**/*.{ts,tsx}'],
  unbundle: true,
  dts: true,
  format: 'esm',
  platform: 'neutral',
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  // The server loader is picked by export conditions (node / browser) in
  // the host's bundler, so this self-import stays a bare specifier in dist.
  external: [/^@next-federation\/react\//],
})
