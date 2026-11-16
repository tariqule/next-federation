import { isNFError } from '@next-federation/sdk'
import { resolveOptions } from '../src/options.ts'
import type { IslandRemoteOptions } from '../src/options.ts'
import { ISLAND_SHARE_SCOPE, resolveShared } from '../src/share.ts'

const VERSIONS: Record<string, string> = {
  react: '19.3.1',
  'react-dom': '19.3.1',
  '@acme/design': '2.4.0',
  'date-lib': '1.0.0',
}
const readVersion = (pkg: string): string => {
  const version = VERSIONS[pkg]
  if (!version) throw new Error(`Cannot find module '${pkg}/package.json'`)
  return version
}

const REACT = [
  { name: 'react', version: '19.3.1' },
  { name: 'react-dom', version: '19.3.1' },
  { name: 'react-dom/client', version: '19.3.1' },
  { name: 'react/jsx-runtime', version: '19.3.1' },
]

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return isNFError(error) ? error.code : `not an NFError: ${String(error)}`
  }
  return undefined
}

test('always shares the four React entries at the installed exact version', () => {
  expect(ISLAND_SHARE_SCOPE).toBe('nf-islands')
  expect(resolveShared([], readVersion)).toEqual(REACT)
  // Listing a React entry again changes nothing.
  expect(resolveShared(['react', 'react-dom/client'], readVersion)).toEqual(
    REACT
  )
})

test('extra libs are added with their exact versions', () => {
  expect(
    resolveShared(
      ['@acme/design', '@acme/design/tokens', 'date-lib'],
      readVersion
    )
  ).toEqual([
    ...REACT,
    { name: '@acme/design', version: '2.4.0' },
    { name: '@acme/design/tokens', version: '2.4.0' },
    { name: 'date-lib', version: '1.0.0' },
  ])
})

test('react-server-dom-webpack in libs is NF-002', () => {
  for (const lib of [
    'react-server-dom-webpack',
    'react-server-dom-webpack/client.browser',
  ]) {
    expect(codeOf(() => resolveShared([lib], readVersion))).toBe('NF-002')
  }
})

test('a lib whose version cannot be read, or a non-bare specifier, is NF-002', () => {
  expect(codeOf(() => resolveShared(['missing-lib'], readVersion))).toBe(
    'NF-002'
  )
  expect(codeOf(() => resolveShared(['react'], () => ''))).toBe('NF-002')
  for (const lib of ['./local', '/abs', '', '@scope']) {
    expect(codeOf(() => resolveShared([lib], readVersion))).toBe('NF-002')
  }
})

const opts: IslandRemoteOptions = {
  name: 'shop',
  base: 'https://r.example/',
  islands: { Panel: './src/islands/Panel.tsx' },
  hosts: ['https://host.example'],
}

test('serve never shares; build shares by default; share: false disables', () => {
  const ctx = (command: 'serve' | 'build') => ({
    command,
    env: {},
    now: 0,
    readVersion,
  })
  expect(resolveOptions(opts, ctx('serve')).share).toBeNull()
  expect(
    resolveOptions({ ...opts, share: true }, ctx('serve')).share
  ).toBeNull()
  expect(resolveOptions(opts, ctx('build')).share).toEqual({
    scope: 'nf-islands',
    libs: REACT,
  })
  expect(
    resolveOptions({ ...opts, share: false }, ctx('build')).share
  ).toBeNull()
  expect(
    resolveOptions({ ...opts, share: { libs: ['date-lib'] } }, ctx('build'))
      .share
  ).toEqual({
    scope: 'nf-islands',
    libs: [...REACT, { name: 'date-lib', version: '1.0.0' }],
  })
  expect(
    codeOf(() =>
      resolveOptions(
        { ...opts, share: 'yes' as unknown as boolean },
        ctx('build')
      )
    )
  ).toBe('NF-002')
  expect(
    codeOf(() =>
      resolveOptions(
        { ...opts, share: { libs: ['react-server-dom-webpack'] } },
        ctx('build')
      )
    )
  ).toBe('NF-002')
})
