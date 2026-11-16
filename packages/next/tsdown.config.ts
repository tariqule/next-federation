import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/**/*.{ts,tsx}'],
  unbundle: true,
  dts: true,
  format: 'esm',
  platform: 'node',
  fixedExtension: false,
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  // The island cache is chosen by the host's bundler alias (withNextFederation),
  // so this self-import must stay a bare specifier in dist.
  external: [/^@next-federation\/next\//],
})
