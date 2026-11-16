import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rstest/core'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Unit tests resolve `@next-federation/*` imports to each package's source
 * (derived from its `exports` map: `./dist/x/index.js` -> `src/x/index.ts`),
 * so no test depends on a prior build.
 */
function workspaceSourceAliases(): Record<string, string> {
  const alias: Record<string, string> = {}
  const packagesDir = join(root, 'packages')
  for (const dir of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string
      exports?: Record<string, unknown>
    }
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const entry =
        typeof target === 'object' && target !== null
          ? (target as Record<string, unknown>).default
          : target
      if (typeof entry !== 'string' || !entry.startsWith('./dist/')) continue
      const base = join(
        packagesDir,
        dir,
        'src',
        entry.slice('./dist/'.length).replace(/\.js$/, '')
      )
      const source = ['.ts', '.tsx'].map((e) => base + e).find(existsSync)
      if (!source) continue
      // `$` makes the alias exact, so `core` does not capture `core/identity`.
      alias[`${manifest.name}${subpath === '.' ? '' : subpath.slice(1)}$`] =
        resolve(source)
    }
  }
  return alias
}

const common = {
  globals: true,
  testTimeout: 10000,
  resolve: { alias: workspaceSourceAliases() },
}

export default defineConfig({
  projects: [
    {
      ...common,
      name: 'node',
      testEnvironment: 'node',
      include: [
        'packages/*/__tests__/**/*.spec.ts',
        'scripts/__tests__/*.spec.ts',
      ],
    },
    {
      ...common,
      name: 'dom',
      testEnvironment: 'happy-dom',
      include: ['packages/*/__tests__/**/*.spec.tsx'],
      // The libraries use the automatic JSX runtime (tsconfig `react-jsx`).
      tools: {
        swc: { jsc: { transform: { react: { runtime: 'automatic' } } } },
      },
    },
  ],
})
