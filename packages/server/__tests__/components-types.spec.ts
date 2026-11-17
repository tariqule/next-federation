// Type declarations of a components build: `client/@mf-types/` (written by
// @next-federation/vite, or by any tool with Module Federation's layout),
// listed with their sha384 in the signed descriptor.
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isNFError } from '@next-federation/sdk'
import { canonicalJson } from '@next-federation/protocol'
import {
  collectTypesIndex,
  writeTypesIndex,
} from '../src/node/components-descriptor.ts'
import {
  describeComponentsBuild,
  verifyComponentsBuild,
} from '../src/node/describe.ts'

const sri = (text: string) =>
  `sha384-${createHash('sha384').update(text).digest('base64')}`

const BASE = 'https://shop.example/b/r1/'
const ENTRY_DTS =
  "export * from './compiled-types/src/Counter.js'\nexport { default } from './compiled-types/src/Counter.js'\n"
const COUNTER_DTS =
  'export default function Counter(props: { start?: number }): unknown\n'

let root: string
let dir: string
let client: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nf-types-'))
  dir = join(root, 'r1')
  client = join(dir, 'client')
  await mkdir(join(client, 'server'), { recursive: true })
  await writeFile(
    join(client, 'mf-manifest.json'),
    JSON.stringify({
      id: 'shop',
      name: 'shop',
      metaData: {
        name: 'shop',
        publicPath: BASE,
        remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
      },
      exposes: [
        { path: './Counter', assets: { js: { sync: [] }, css: { sync: [] } } },
        { path: './Other', assets: { js: { sync: [] }, css: { sync: [] } } },
      ],
    })
  )
  await writeFile(join(client, 'remoteEntry.js'), 'export {}')
  await writeFile(join(client, 'server', 'remoteEntry.js'), 'exports.x = 1')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeTypes(): Promise<void> {
  await mkdir(join(client, '@mf-types', 'compiled-types', 'src'), {
    recursive: true,
  })
  await writeFile(join(client, '@mf-types', 'Counter.d.ts'), ENTRY_DTS)
  await writeFile(
    join(client, '@mf-types', 'compiled-types', 'src', 'Counter.d.ts'),
    COUNTER_DTS
  )
  // Not a declaration file: never listed (hosts download only .d.ts files).
  await writeFile(join(client, '@mf-types', 'notes.txt'), 'x')
}

function codeOf(error: unknown): string {
  return isNFError(error) ? error.code : `not an NFError: ${String(error)}`
}

test('a build without @mf-types/ has no types', async () => {
  expect(await collectTypesIndex(client)).toBeUndefined()
})

test("lists every .d.ts under @mf-types/ with its sha384, and each expose's entry file", async () => {
  await writeTypes()
  expect(await collectTypesIndex(client)).toEqual({
    // ./Other has no entry declaration file: not listed.
    exposes: { './Counter': '@mf-types/Counter.d.ts' },
    files: {
      '@mf-types/Counter.d.ts': sri(ENTRY_DTS),
      '@mf-types/compiled-types/src/Counter.d.ts': sri(COUNTER_DTS),
    },
  })
})

test('a symlinked declaration file is NF-002', async () => {
  await writeTypes()
  const outside = join(root, 'outside.d.ts')
  await writeFile(outside, 'export {}')
  await symlink(outside, join(client, '@mf-types', 'Evil.d.ts'))
  const error = await collectTypesIndex(client).catch((e: unknown) => e)
  expect(codeOf(error)).toBe('NF-002')
})

test('a symlinked @mf-types/ folder is NF-002', async () => {
  const outside = join(root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'Counter.d.ts'), ENTRY_DTS)
  await symlink(outside, join(client, '@mf-types'))
  const error = await collectTypesIndex(client).catch((e: unknown) => e)
  expect(codeOf(error)).toBe('NF-002')
})

test('writeTypesIndex writes @mf-types/index.json and returns the one signed entry', async () => {
  await writeTypes()
  const types = await writeTypesIndex(client, BASE)
  const bytes = await readFile(join(client, '@mf-types', 'index.json'), 'utf8')
  expect(bytes).toBe(`${canonicalJson(await collectTypesIndex(client))}\n`)
  expect(types).toEqual({
    index: `${BASE}@mf-types/index.json`,
    integrity: sri(bytes),
  })
  expect(await writeTypesIndex(join(root, 'none'), BASE)).toBeUndefined()
})

test('writeTypesIndex refuses a symlinked index.json (NF-002)', async () => {
  await writeTypes()
  const outside = join(root, 'outside.json')
  await writeFile(outside, '{}')
  await symlink(outside, join(client, '@mf-types', 'index.json'))
  const error = await writeTypesIndex(client, BASE).catch((e: unknown) => e)
  expect(codeOf(error)).toBe('NF-002')
})

test('nf-describe signs the index with the descriptor; verify catches an edited, added or re-indexed declaration (NF-027)', async () => {
  await writeTypes()
  const { file } = await describeComponentsBuild({
    dir,
    ssrEntry: 'server/remoteEntry.js',
    env: {},
  })
  expect(file.types?.index).toBe(`${BASE}@mf-types/index.json`)
  await expect(verifyComponentsBuild(dir)).resolves.toBeDefined()

  const counter = join(client, '@mf-types', 'compiled-types', 'src')
  await writeFile(join(counter, 'Counter.d.ts'), 'export default any\n')
  let error = await verifyComponentsBuild(dir).catch((e: unknown) => e)
  expect(codeOf(error)).toBe('NF-027')

  await writeFile(join(counter, 'Counter.d.ts'), COUNTER_DTS)
  await writeFile(join(counter, 'Extra.d.ts'), 'export {}\n')
  error = await verifyComponentsBuild(dir).catch((e: unknown) => e)
  expect(codeOf(error)).toBe('NF-027')

  // A rewritten index (matching the files) no longer matches the signed hash.
  await writeTypesIndex(client, BASE)
  error = await verifyComponentsBuild(dir).catch((e: unknown) => e)
  expect(codeOf(error)).toBe('NF-027')
})
