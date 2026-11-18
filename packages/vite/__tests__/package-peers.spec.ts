// The published peer ranges: npm (unlike pnpm) refuses to install a peer
// outside them (ERESOLVE), so a range must not exclude versions a new
// project gets by default.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { satisfies } from '@next-federation/protocol'
import { isNFError } from '@next-federation/sdk'
import type { NFError } from '@next-federation/sdk'
import { assertPatchedFlightClient } from '../src/checks.ts'
import { nextFederationIslands } from '../src/index.ts'
import {
  assertFlightClientInstalled,
  assertFlightClientPatched,
  flightClientCheckResolvers,
  installedFlightClientVersions,
} from '../src/plugin-rsc/version.ts'

const pkg = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')
) as {
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
}

test('typescript is an optional peer with no upper bound (create-vite installs TypeScript 7)', () => {
  // TypeScript 7 has no compiler API: `types: true` warns NF-002 at build
  // time instead of npm refusing to install every remote.
  expect(pkg.peerDependencies.typescript).toBe('>=5.0.0')
  expect(pkg.peerDependenciesMeta.typescript).toEqual({ optional: true })
})

test('react-server-dom-webpack is an optional peer: a components remote never uses it', () => {
  // npm resolves a required peer to its newest version (whose own peer is
  // that React), so a remote on an older React 19 got ERESOLVE.
  expect(pkg.peerDependenciesMeta['react-server-dom-webpack']).toEqual({
    optional: true,
  })
})

describe('the react-server-dom-webpack peer range excludes GHSA-xqc2-xf4c-x3h3', () => {
  const range = pkg.peerDependencies['react-server-dom-webpack']!
  const series = (minor: number, below: number): string[] =>
    Array.from({ length: below }, (_, patch) => `19.${minor}.${patch}`)
  // Affected: 19.0.0-19.0.8, 19.1.0-19.1.9, 19.2.0-19.2.8, 19.3.0.
  const affected = [
    ...series(0, 9),
    ...series(1, 10),
    ...series(2, 9),
    '19.3.0',
  ]

  test.each(affected)('refuses %s', (version) => {
    expect(satisfies(version, range)).toBe(false)
  })

  test.each([
    '19.0.9',
    '19.0.10',
    '19.1.10',
    '19.1.11',
    '19.2.9',
    '19.2.10',
    '19.3.1',
    '19.3.2',
    '19.4.0',
  ])('accepts the patched %s', (version) => {
    expect(satisfies(version, range)).toBe(true)
  })

  test.each(['18.3.1', '20.0.0'])(
    'stays on React 19: refuses %s',
    (version) => {
      expect(satisfies(version, range)).toBe(false)
    }
  )
})

function installReact(root: string, version: string): void {
  mkdirSync(join(root, 'node_modules', 'react'), { recursive: true })
  writeFileSync(
    join(root, 'node_modules', 'react', 'package.json'),
    JSON.stringify({ name: 'react', version, main: 'index.js' })
  )
  writeFileSync(join(root, 'node_modules', 'react', 'index.js'), '')
}

describe('island remotes need react-server-dom-webpack (NF-002 when missing)', () => {
  const missing = (id: string): string => {
    throw Object.assign(new Error(`Cannot find module '${id}'`), {
      code: 'MODULE_NOT_FOUND',
    })
  }
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'nf-flight-client-'))
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    installReact(root, '19.3.1')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  test('missing: NF-002 naming the exact install command for this React', () => {
    let thrown: unknown
    try {
      assertFlightClientInstalled(root, [missing, missing])
    } catch (error) {
      thrown = error
    }
    expect(isNFError(thrown)).toBe(true)
    expect((thrown as NFError).code).toBe('NF-002')
    expect((thrown as Error).message).toContain(
      'npm install --save-exact react-server-dom-webpack@19.3.1'
    )
  })

  test('missing, on a React affected by GHSA-xqc2-xf4c-x3h3: the command upgrades all three to the patched version', () => {
    const old = mkdtempSync(join(tmpdir(), 'nf-flight-client-old-'))
    try {
      writeFileSync(join(old, 'package.json'), '{"type":"module"}')
      installReact(old, '19.2.3')
      let thrown: unknown
      try {
        assertFlightClientInstalled(old, [missing, missing])
      } catch (error) {
        thrown = error
      }
      expect((thrown as NFError).code).toBe('NF-002')
      expect((thrown as Error).message).toContain(
        'npm install --save-exact react@19.2.9 react-dom@19.2.9 react-server-dom-webpack@19.2.9'
      )
      expect((thrown as Error).message).toContain('GHSA-xqc2-xf4c-x3h3')
    } finally {
      rmSync(old, { recursive: true, force: true })
    }
  })

  test('installed (found from the plugin or from the project): no error', () => {
    expect(() =>
      assertFlightClientInstalled(root, [missing, () => '/x/package.json'])
    ).not.toThrow()
    // The default resolvers find this workspace's copy.
    expect(() => assertFlightClientInstalled(root)).not.toThrow()
  })

  test('the island plugin checks it when Vite resolves the config', () => {
    const plugins = nextFederationIslands({
      name: 'shop',
      base: 'https://shop.example/',
      islands: { Panel: './src/Panel.tsx' },
      hosts: ['http://localhost:3100'],
      buildId: 'v1',
    })
    const config = plugins.find((p) => p.name === 'nf:config')!
    const hook = config.config as (...a: unknown[]) => unknown
    // This workspace has it: the hook goes on.
    expect(() =>
      hook({ root }, { command: 'build', mode: 'production' })
    ).not.toThrow()
  })
})

describe('island remotes refuse a react-server-dom-webpack affected by GHSA-xqc2-xf4c-x3h3 (NF-041)', () => {
  let root: string
  const install = (version: string): void => {
    const dir = join(root, 'node_modules', 'react-server-dom-webpack')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'react-server-dom-webpack', version })
    )
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nf-flight-advisory-'))
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rs.restoreAllMocks()
  })

  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn()
    } catch (error) {
      return isNFError(error) ? error.code : String(error)
    }
    return undefined
  }

  test('the copy next to a hoisted @vitejs/plugin-rsc is checked (npm or yarn workspaces)', () => {
    // plugin-rsc (hoisted) resolves react-server-dom-webpack/server.edge from
    // its own folder: an affected copy there is what the server bundle gets,
    // while @next-federation/vite (nested) sees a patched one.
    const manifest = (dir: string, json: object): string => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(json))
      return join(dir, 'package.json')
    }
    const hoisted = join(root, 'workspace', 'node_modules')
    const pluginRsc = manifest(join(hoisted, '@vitejs', 'plugin-rsc'), {
      name: '@vitejs/plugin-rsc',
      version: '0.5.39',
    })
    manifest(join(hoisted, 'react-server-dom-webpack'), {
      name: 'react-server-dom-webpack',
      version: '19.3.0',
    })
    const nested = manifest(
      join(
        root,
        'workspace',
        'remote',
        'node_modules',
        'react-server-dom-webpack'
      ),
      { name: 'react-server-dom-webpack', version: '19.3.1' }
    )
    const fromVite = (id: string): string => {
      if (id === '@vitejs/plugin-rsc/package.json') return pluginRsc
      if (id === 'react-server-dom-webpack/package.json') return nested
      throw Object.assign(new Error(`Cannot find module '${id}'`), {
        code: 'MODULE_NOT_FOUND',
      })
    }
    // Control: from @next-federation/vite alone, only the patched copy shows.
    expect(
      codeOf(() => assertFlightClientPatched(root, 'build', [fromVite]))
    ).toBeUndefined()
    const resolvers = flightClientCheckResolvers(root, fromVite)
    expect(installedFlightClientVersions(root, resolvers)).toEqual([
      '19.3.0',
      '19.3.1',
    ])
    expect(
      codeOf(() => assertFlightClientPatched(root, 'build', resolvers))
    ).toBe('NF-041')
  })

  test('the copy in the project root is checked: 19.3.0 fails the build', () => {
    install('19.3.0')
    expect(codeOf(() => assertFlightClientPatched(root, 'build'))).toBe(
      'NF-041'
    )
  })

  test('the patched 19.3.1 (in the project root and in this workspace) passes', () => {
    install('19.3.1')
    expect(codeOf(() => assertFlightClientPatched(root, 'build'))).toBe(
      undefined
    )
  })

  test('every copy found is checked, not only the first', () => {
    install('19.2.0')
    const manifest = join(
      root,
      'node_modules/react-server-dom-webpack/package.json'
    )
    const patched = join(root, 'patched.json')
    writeFileSync(patched, '{"version":"19.3.1"}')
    expect(
      codeOf(() =>
        assertFlightClientPatched(root, 'build', [
          () => patched,
          () => manifest,
        ])
      )
    ).toBe('NF-041')
  })

  test('the island plugin refuses it when a build starts, and warns under the dev server', () => {
    install('19.1.4')
    const plugins = nextFederationIslands({
      name: 'shop',
      base: 'https://shop.example/',
      islands: { Panel: './src/Panel.tsx' },
      hosts: ['http://localhost:3100'],
      buildId: 'v1',
    })
    const config = plugins.find((p) => p.name === 'nf:config')!
    const hook = config.config as (...a: unknown[]) => unknown
    expect(
      codeOf(() => hook({ root }, { command: 'build', mode: 'production' }))
    ).toBe('NF-041')
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      codeOf(() => hook({ root }, { command: 'serve', mode: 'development' }))
    ).toBeUndefined()
    expect(String(warn.mock.calls.flat().join(' '))).toMatch(
      /NF-041.*19\.1\.4.*19\.1\.10 or later/
    )
  })

  test('the copy vendored in the pinned @vitejs/plugin-rsc is patched', () => {
    // plugin-rsc renders with its vendored copy when the project has none.
    const pluginRsc = dirname(
      createRequire(import.meta.url).resolve('@vitejs/plugin-rsc/package.json')
    )
    const vendored = JSON.parse(
      readFileSync(
        join(pluginRsc, 'dist/vendor/react-server-dom/package.json'),
        'utf8'
      )
    ) as { version: string }
    expect(
      codeOf(() =>
        assertPatchedFlightClient(vendored.version, pluginRsc, 'build')
      )
    ).toBeUndefined()
  })
})
