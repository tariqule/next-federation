// installedVersion: the version of a package installed for a project, read
// from its package.json in the nearest node_modules folder (as Node finds it),
// whatever the package's `exports` allow.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installedVersion } from '../src/node/installed-version.ts'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nf-installed-version-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function install(dir: string, name: string, manifest: unknown): void {
  const folder = join(dir, 'node_modules', name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, 'package.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
  )
}

test('reads the version of a scoped package installed in the root', () => {
  // `exports` without "./package.json": still read.
  install(root, '@next-federation/router', {
    name: '@next-federation/router',
    version: '0.2.3',
    exports: { '.': './index.js' },
  })
  expect(installedVersion(root, '@next-federation/router')).toBe('0.2.3')
})

test('finds a package installed in a parent folder (hoisted)', () => {
  install(root, 'lib', { name: 'lib', version: '1.4.2' })
  const app = join(root, 'apps', 'remote')
  mkdirSync(app, { recursive: true })
  expect(installedVersion(app, 'lib')).toBe('1.4.2')
})

test('the nearest install wins', () => {
  install(root, 'lib', { name: 'lib', version: '1.0.0' })
  const app = join(root, 'app')
  install(app, 'lib', { name: 'lib', version: '2.0.0' })
  expect(installedVersion(app, 'lib')).toBe('2.0.0')
})

test('null when the package is not installed, or its manifest has no version', () => {
  expect(installedVersion(root, '@next-federation/router')).toBeNull()
  install(root, 'no-version', { name: 'no-version' })
  expect(installedVersion(root, 'no-version')).toBeNull()
  install(root, 'broken', '{ not json')
  expect(installedVersion(root, 'broken')).toBeNull()
})

test('null for a name that is not a bare package name (never reads outside node_modules)', () => {
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'x', version: '9.9.9' })
  )
  const app = join(root, 'app')
  mkdirSync(join(app, 'node_modules'), { recursive: true })
  for (const name of ['..', '../..', '/etc', 'lib/../..', '', '@scope']) {
    expect(installedVersion(app, name)).toBeNull()
  }
})
