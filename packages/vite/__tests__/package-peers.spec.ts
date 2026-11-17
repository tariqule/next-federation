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
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isNFError } from '@next-federation/sdk'
import type { NFError } from '@next-federation/sdk'
import { nextFederationIslands } from '../src/index.ts'
import { assertFlightClientInstalled } from '../src/plugin-rsc/version.ts'

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
  expect(pkg.peerDependencies['react-server-dom-webpack']).toBe('^19.0.0')
  expect(pkg.peerDependenciesMeta['react-server-dom-webpack']).toEqual({
    optional: true,
  })
})

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
    mkdirSync(join(root, 'node_modules', 'react'), { recursive: true })
    writeFileSync(
      join(root, 'node_modules', 'react', 'package.json'),
      '{"name":"react","version":"19.3.0","main":"index.js"}'
    )
    writeFileSync(join(root, 'node_modules', 'react', 'index.js'), '')
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
      'npm install --save-exact react-server-dom-webpack@19.3.0'
    )
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
