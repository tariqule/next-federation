import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/**/*.ts'],
  unbundle: true,
  dts: true,
  format: 'esm',
  platform: 'neutral',
  tsconfig: 'tsconfig.lib.json',
  clean: true,
})
