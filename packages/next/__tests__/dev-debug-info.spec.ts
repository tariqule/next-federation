import { devDebugInfoCause } from '../src/server/dev-debug-info.ts'

const INSTALLED =
  'file:///app/node_modules/.pnpm/@next-federation+next@1.0.0/node_modules/@next-federation/next/dist/server/private-envelope.js'
const LINKED = 'file:///repo/packages/next/dist/server/private-envelope.js'

test('a module URL outside node_modules is a linked install', () => {
  expect(devDebugInfoCause(LINKED, true)).toBe('linked')
  expect(devDebugInfoCause(INSTALLED, true)).toBeNull()
  expect(
    devDebugInfoCause(
      'file:///C:/app/node_modules/@next-federation/next/dist/server/x.js',
      true
    )
  ).toBeNull()
})

test("an install under node_modules with Node's source maps off (`next dev --disable-source-maps`)", () => {
  expect(devDebugInfoCause(INSTALLED, false)).toBe('source-maps-off')
  // Linked wins: it applies with or without source maps.
  expect(devDebugInfoCause(LINKED, false)).toBe('linked')
})

test('a runtime without process.sourceMapsEnabled counts as source maps off (conservative)', () => {
  expect(devDebugInfoCause(INSTALLED, undefined)).toBe('source-maps-off')
})

test('defaults: this module URL and process.sourceMapsEnabled', () => {
  // The tests import the source: linked.
  expect(devDebugInfoCause()).toBe('linked')
})
