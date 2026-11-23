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

/**
 * The `dom-react18` project runs specs and library source on React 18.3.1
 * from `test/react18` (its own install, outside the workspace). The aliases
 * are exact, so every importer, React DOM included, gets the same copy.
 */
function react18Aliases(): Record<string, string> {
  const modules = join(root, 'test/react18/node_modules')
  return {
    react$: join(modules, 'react/index.js'),
    'react/jsx-runtime$': join(modules, 'react/jsx-runtime.js'),
    'react/jsx-dev-runtime$': join(modules, 'react/jsx-dev-runtime.js'),
    'react-dom$': join(modules, 'react-dom/index.js'),
    'react-dom/client$': join(modules, 'react-dom/client.js'),
    // React DOM 18's `browser` field maps `./server.js` to the browser
    // build, which has no `renderToPipeableStream`.
    'react-dom/server$': join(modules, 'react-dom/server.node.js'),
  }
}

const routerVersion = (
  JSON.parse(
    readFileSync(join(root, 'packages/router/package.json'), 'utf8')
  ) as { version: string }
).version

/**
 * The React Router shim (`packages/router/src/shims/react-router.tsx`)
 * imports the real package by this name; a remote build aliases it to its
 * own react-router, the specs to the router package's.
 */
const realReactRouter = {
  '@next-federation/router/real-react-router$': join(
    root,
    'packages/router/node_modules/react-router'
  ),
}

const common = {
  globals: true,
  source: {
    define: { __NF_ROUTER_VERSION__: JSON.stringify(routerVersion) },
  },
  testTimeout: 10000,
  resolve: { alias: { ...workspaceSourceAliases(), ...realReactRouter } },
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
      // Node specs may import .tsx sources (e.g. Server Components).
      tools: {
        swc: { jsc: { transform: { react: { runtime: 'automatic' } } } },
      },
    },
    {
      ...common,
      name: 'dom',
      testEnvironment: 'happy-dom',
      include: ['packages/*/__tests__/**/*.spec.tsx'],
      // React 18 specs run in `dom-react18` only.
      exclude: ['packages/*/__tests__/react18/**'],
      // The libraries use the automatic JSX runtime (tsconfig `react-jsx`).
      tools: {
        swc: { jsc: { transform: { react: { runtime: 'automatic' } } } },
      },
    },
    {
      ...common,
      name: 'dom-react18',
      testEnvironment: 'happy-dom',
      // Every React 18 spec, in any package, goes in `__tests__/react18/`.
      include: ['packages/*/__tests__/react18/**/*.spec.tsx'],
      resolve: {
        alias: { ...common.resolve.alias, ...react18Aliases() },
      },
      tools: {
        swc: { jsc: { transform: { react: { runtime: 'automatic' } } } },
      },
    },
  ],
})
