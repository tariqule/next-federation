import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

export default defineConfig({
  entry: ['src/**/*.{ts,tsx}'],
  unbundle: true,
  dts: true,
  format: 'esm',
  platform: 'neutral',
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  define: { __NF_ROUTER_VERSION__: JSON.stringify(version) },
  // The shims import this package by name (so a remote build shares it) and
  // the real React Router through the name the build aliases.
  external: [/^@next-federation\/router(\/|$)/, /^node:/],
})
