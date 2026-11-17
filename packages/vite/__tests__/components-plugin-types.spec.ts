// The descriptor's `types` entry is opt-in: the plugin signs a build's
// `client/@mf-types/` folder only with `types: true`, never just because the
// folder is there (another tool may have left one). Runs the plugin's
// buildApp step on a prepared build folder, with a stub builder.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { nextFederationComponents } from '../src/components/plugin.ts'

const ENV_KEYS = [
  'NF_VITE_COMMAND',
  'MFE_VITE_NO_TEST_ENV_CHECK',
  'NF_COMPONENTS_BUILT_AT',
  'NF_COMPONENTS_SIGNING_KEY',
  'NF_BUILD_ID',
]
let saved: Record<string, string | undefined>
let root: string

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.NF_VITE_COMMAND = 'build'
  process.env.MFE_VITE_NO_TEST_ENV_CHECK = 'true'
  delete process.env.NF_COMPONENTS_SIGNING_KEY
  root = await mkdtemp(join(tmpdir(), 'nf-plugin-types-'))
  const client = join(root, 'dist', 't1', 'client')
  await mkdir(join(client, '@mf-types'), { recursive: true })
  await writeFile(
    join(client, 'mf-manifest.json'),
    JSON.stringify({
      name: 'shop',
      metaData: {
        name: 'shop',
        remoteEntry: { name: 'remoteEntry.js', path: '' },
      },
      exposes: [
        { path: './Counter', assets: { js: { sync: [] }, css: { sync: [] } } },
      ],
      shared: [],
    })
  )
  await writeFile(join(client, 'remoteEntry.js'), 'export {}\n')
  // Declarations the build did not ask to publish.
  await writeFile(
    join(client, '@mf-types', 'Counter.d.ts'),
    'export default function Counter(): unknown\n'
  )
})

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(root, { recursive: true, force: true })
})

async function runBuildApp(types: boolean | undefined) {
  const plugins = nextFederationComponents({
    name: 'shop',
    base: 'https://shop.example/',
    buildId: 't1',
    exposes: { './Counter': './src/Counter.tsx' },
    ssr: false,
    ...(types === undefined ? {} : { types }),
  }) as Plugin[]
  const nf = plugins.find((p) => p.name === 'nf:components')!
  const buildApp = nf.buildApp as {
    handler: (builder: unknown) => Promise<void>
  }
  await buildApp.handler({
    config: { root },
    environments: { client: { isBuilt: true } },
    build: async () => {},
  })
  const dir = join(root, 'dist', 't1')
  return JSON.parse(
    await readFile(join(dir, 'nf-components.json'), 'utf8')
  ) as { types?: unknown }
}

test.each([
  ['omitted', undefined],
  ['false', false],
] as const)(
  'types %s: an @mf-types/ folder in the build is not signed or indexed',
  async (_label, types) => {
    const descriptor = await runBuildApp(types)
    expect(descriptor.types).toBeUndefined()
    await expect(
      readFile(join(root, 'dist', 't1', 'client', '@mf-types', 'index.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  }
)
