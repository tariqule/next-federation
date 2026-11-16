// The Mode A server loader must never reach a browser bundle: a browser build
// of `@next-federation/react/components` (from its dist, as a host bundles
// it) resolves the loader through the `browser` export condition to a stub.
// Needs the workspace packages built (`pnpm build`). Also measures the client
// JS the host runtime adds (bounded below; measured for the Task 28 report).
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

const reactPkg = resolve(import.meta.dirname, '../../react')
const entry = join(reactPkg, 'dist/components/index.js')
// Strings only the server loader has (Module Federation's own runtime has
// node code paths too, e.g. `getBuiltinModule`, so those are no markers).
const MARKERS = [
  'nf-components-server-loader',
  'does not match its sha384',
  'which the host does not provide',
]

async function bundle(conditions: string[], ssr: boolean): Promise<string> {
  // Inside the react package, so its own dependencies resolve.
  const dir = await mkdtemp(join(reactPkg, 'node_modules/.nf-bundle-'))
  try {
    const main = join(dir, 'main.js')
    await writeFile(main, `export * from ${JSON.stringify(entry)}\n`)
    await build({
      root: dir,
      logLevel: 'silent',
      configFile: false,
      resolve: { conditions, ...(ssr ? { noExternal: true } : {}) },
      ...(ssr ? { ssr: { noExternal: true, resolve: { conditions } } } : {}),
      build: {
        outDir: join(dir, 'out'),
        ssr: ssr ? main : undefined,
        minify: true,
        lib: ssr
          ? undefined
          : { entry: main, formats: ['es'], fileName: 'out' },
        rollupOptions: {
          // The host provides React; measure the runtime only.
          external: [/^react($|\/)/, /^react-dom($|\/)/],
        },
      },
    })
    const files = await readdir(join(dir, 'out'), { recursive: true })
    const js = await Promise.all(
      files
        .filter((f) => String(f).endsWith('.js'))
        .map((f) => readFile(join(dir, 'out', String(f)), 'utf8'))
    )
    return js.join('\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the browser bundle has no server loader; the server bundle has it', async () => {
  expect(existsSync(entry)).toBe(true)
  const browser = await bundle(
    ['browser', 'import', 'module', 'default'],
    false
  )
  for (const marker of MARKERS) expect(browser).not.toContain(marker)
  // It is the real runtime (Module Federation included).
  expect(browser).toContain('nf:component')
  const gzip = gzipSync(browser).length
  // Recorded in the Task 28 report; a bound so a regression is visible.
  expect(gzip).toBeLessThan(60_000)

  const server = await bundle(['node', 'import', 'module', 'default'], true)
  expect(server).toContain('nf-components-server-loader')
}, 60_000)
