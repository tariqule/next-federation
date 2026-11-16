// The descriptor's `shared` field, bundler-neutral: built from
// mf-manifest.json (and the Vite plugin's per-expose usage file when present),
// shared by nextFederationComponents and nf-describe.
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SHARED_USAGE_FILE,
  readSharedUsage,
  sharedFromManifest,
} from '../src/node/components-descriptor.ts'

const entry = (
  name: string,
  singleton: boolean,
  requiredVersion: unknown,
  version = '1.0.0'
) => ({ name, singleton, requiredVersion, version })

const manifest = {
  shared: [
    entry('react', true, '^19.0.0', '19.3.1'),
    entry('react-dom', true, '^19.0.0', '19.3.1'),
    entry('react-dom/client', false, '^19.0.0', '19.3.1'),
    entry('react/jsx-runtime', true, '^19.0.0', '19.3.1'),
    entry('components-context', true, false),
    entry('date-lib', false, '^2.0.0', '2.3.1'),
    entry('next/link', false, null, '16.4.6'),
    entry('rspack-host-only', true, null, ''),
    entry('odd-range', true, 'workspace:*'),
    { name: 7, singleton: true },
  ],
}

test('every shared module but React; a non-singleton is a bundled fallback copy', () => {
  expect(sharedFromManifest(manifest, null)).toEqual({
    'components-context': { requiredVersion: false, fallback: false },
    'date-lib': { requiredVersion: '^2.0.0', fallback: true, version: '2.3.1' },
    // next/* never falls back (always the host's router).
    'next/link': { requiredVersion: false, fallback: false },
    'rspack-host-only': { requiredVersion: false, fallback: false },
    // A range hosts cannot evaluate: any version.
    'odd-range': { requiredVersion: false, fallback: false },
  })
})

test('the per-expose usage lists the exposes that import each module', () => {
  const usage = new Map([
    ['./Versioned', new Set(['date-lib'])],
    ['./NavLink', new Set(['next/link'])],
    ['./Counter', new Set(['components-context', 'date-lib'])],
  ])
  const shared = sharedFromManifest(manifest, usage)
  expect(shared?.['date-lib']?.exposes).toEqual(['./Counter', './Versioned'])
  expect(shared?.['rspack-host-only']?.exposes).toEqual([])
})

test('no shared module besides React: no field (older hosts verify it unchanged)', () => {
  expect(
    sharedFromManifest({ shared: [entry('react', true, '^19.0.0')] }, null)
  ).toBeUndefined()
  expect(sharedFromManifest({}, null)).toBeUndefined()
})

describe('readSharedUsage', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nf-usage-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('reads the usage the Vite plugin wrote; none (Rspack, webpack) is unknown', async () => {
    expect(await readSharedUsage(dir)).toBeNull()
    await writeFile(
      join(dir, SHARED_USAGE_FILE),
      JSON.stringify({ './Counter': ['components-context'] })
    )
    expect(await readSharedUsage(dir)).toEqual(
      new Map([['./Counter', new Set(['components-context'])]])
    )
  })

  test('a usage file that is a symlink is NF-002', async () => {
    const outside = join(dir, 'outside.json')
    await writeFile(outside, '{}')
    await symlink(outside, join(dir, SHARED_USAGE_FILE))
    await expect(readSharedUsage(dir)).rejects.toMatchObject({
      code: 'NF-002',
    })
  })
})
