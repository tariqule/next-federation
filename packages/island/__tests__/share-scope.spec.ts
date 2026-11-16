import {
  ISLAND_SHARE_NAMESPACE,
  ISLAND_SHARE_SCOPE,
  islandSharedEntry,
  islandShareScope,
} from '@next-federation/protocol'
import { logger } from '@next-federation/sdk'
import { initIslandShareScope } from '../src/bootstrap/index.ts'

type Lib = { name: string; version: string; get: () => Promise<unknown> }

const g = globalThis as { __FEDERATION__?: unknown }

/** One remote's shared libs: its own copies, counting how often each loads. */
function remote(
  tag: string,
  version = '19.3.1',
  extras: Record<string, string> = {}
) {
  const loads: string[] = []
  const copy = (name: string) => ({ name, copy: tag })
  const lib = (name: string, v = version): Lib => ({
    name,
    version: v,
    get: async () => {
      loads.push(name)
      return copy(name)
    },
  })
  return {
    loads,
    copy,
    shared: [
      lib('react'),
      lib('react-dom'),
      lib('react-dom/client'),
      lib('react/jsx-runtime'),
      ...Object.entries(extras).map(([name, v]) => lib(name, v)),
    ],
  }
}

beforeEach(() => {
  delete g.__FEDERATION__
})

afterEach(() => {
  rstest.restoreAllMocks()
})

test('the first remote provides; a second remote on the same version consumes it', async () => {
  const a = remote('a')
  const b = remote('b')
  const fromA = await initIslandShareScope(a.shared)
  expect(a.loads).toEqual([
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
  ])
  expect(fromA.get('react')).toEqual(a.copy('react'))

  const fromB = await initIslandShareScope(b.shared)
  expect(b.loads).toEqual([])
  for (const { name } of b.shared) {
    // The very object remote a loaded.
    expect(fromB.get(name)).toBe(fromA.get(name))
  }
})

test('a different version is not consumed: the remote uses its own copy', async () => {
  const a = remote('a', '19.3.1')
  const c = remote('c', '19.3.0')
  const fromA = await initIslandShareScope(a.shared)
  const fromC = await initIslandShareScope(c.shared)
  expect(c.loads).toHaveLength(4)
  expect(fromC.get('react')).toEqual(c.copy('react'))
  expect(fromC.get('react')).not.toBe(fromA.get('react'))
  // One provider per exact version.
  expect(Object.keys(islandShareScope().react!).sort()).toEqual([
    '19.3.0',
    '19.3.1',
  ])
  // A third remote on 19.3.0 shares c's copy, not a's.
  const d = remote('d', '19.3.0')
  const fromD = await initIslandShareScope(d.shared)
  expect(d.loads).toEqual([])
  expect(fromD.get('react')).toBe(fromC.get('react'))
})

test('a share-scope failure falls back to the bundled copy and never rejects', async () => {
  const warn = rstest.spyOn(logger, 'warnOnce').mockImplementation(() => {})
  // Another provider registered 19.3.1, but its copy fails to load.
  islandShareScope().react = {
    '19.3.1': islandSharedEntry('19.3.1', 'https://broken.test/', () =>
      Promise.reject(new Error('chunk 404'))
    ),
  }
  const a = remote('a')
  const fromA = await initIslandShareScope(a.shared)
  for (const { name } of a.shared) expect(fromA.get(name)).toEqual(a.copy(name))
  expect(warn).toHaveBeenCalledTimes(1)
  expect(String(warn.mock.calls[0]![2])).toContain('chunk 404')

  // An unusable page global: still the bundled copies.
  Object.defineProperty(globalThis, '__FEDERATION__', {
    configurable: true,
    get() {
      throw new Error('locked')
    },
  })
  try {
    const b = remote('b')
    const fromB = await initIslandShareScope(b.shared)
    expect(fromB.get('react-dom')).toEqual(b.copy('react-dom'))
  } finally {
    delete g.__FEDERATION__
  }
})

test('a loaded entry (a host that provides its React) is used without loading anything', async () => {
  const hostReact = { host: true }
  const entry = islandSharedEntry('19.3.1', 'host', () =>
    Promise.resolve(() => hostReact)
  )
  entry.loaded = true
  entry.lib = () => hostReact
  islandShareScope().react = { '19.3.1': entry }
  const a = remote('a')
  const fromA = await initIslandShareScope(a.shared)
  expect(fromA.get('react')).toBe(hostReact)
  expect(a.loads).toEqual([
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
  ])
})

test('two remotes that initialise at once load one copy', async () => {
  const a = remote('a')
  const b = remote('b')
  const [fromA, fromB] = await Promise.all([
    initIslandShareScope(a.shared),
    initIslandShareScope(b.shared),
  ])
  expect(a.loads).toHaveLength(4)
  expect(b.loads).toEqual([])
  expect(fromB.get('react-dom/client')).toBe(fromA.get('react-dom/client'))
})

test('entries live under the library namespace, never a bare nf-islands key', async () => {
  await initIslandShareScope(remote('a').shared)
  const share = (
    g.__FEDERATION__ as { __SHARE__: Record<string, Record<string, unknown>> }
  ).__SHARE__
  expect(Object.keys(share)).toEqual([ISLAND_SHARE_NAMESPACE])
  expect(Object.keys(share[ISLAND_SHARE_NAMESPACE]!)).toEqual([
    ISLAND_SHARE_SCOPE,
  ])
  const entry = islandShareScope().react!['19.3.1']!
  expect(entry).toMatchObject({
    version: '19.3.1',
    loaded: true,
    strategy: 'loaded-first',
    shareConfig: {
      singleton: false,
      strictVersion: true,
      requiredVersion: '19.3.1',
    },
  })
})

test('an extra lib is shared only between builds on the same React', async () => {
  // c (React 19.3.0) provides @acme/design@1.0.0, bound to its own React.
  const c = remote('c', '19.3.0', { '@acme/design': '1.0.0' })
  await initIslandShareScope(c.shared)
  // a (React 19.3.1) must not take it: the design copy would call c's React.
  const a = remote('a', '19.3.1', { '@acme/design': '1.0.0' })
  const fromA = await initIslandShareScope(a.shared)
  expect(a.loads).toContain('@acme/design')
  expect(fromA.get('@acme/design')).toEqual(a.copy('@acme/design'))
  // b, on a's React, shares a's design copy.
  const b = remote('b', '19.3.1', { '@acme/design': '1.0.0' })
  const fromB = await initIslandShareScope(b.shared)
  expect(b.loads).toEqual([])
  expect(fromB.get('@acme/design')).toBe(fromA.get('@acme/design'))
  // One entry per name@version per React it binds to.
  expect(Object.keys(islandShareScope()['@acme/design']!).sort()).toEqual([
    '1.0.0+react@19.3.0',
    '1.0.0+react@19.3.1',
  ])
})
