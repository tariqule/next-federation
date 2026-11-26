import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { classifyOutcome } from '../src/components/preload-result.ts'
import { createComponentRuntime } from '../src/components/runtime.ts'
import type {
  FederationInstance,
  RuntimeDeps,
  ServerBlock,
} from '../src/components/runtime.ts'

const fakeReact = { useState: () => null, version: '19.3.1' }

function descriptor(
  buildId: string,
  overrides: Partial<RemoteComponentDescriptor> = {}
): RemoteComponentDescriptor {
  const base = `http://127.0.0.1:4110/b/${buildId}/`
  return {
    remote: 'components',
    name: 'components',
    buildId,
    base,
    manifest: `${base}mf-manifest.json`,
    ssr: { integrity: { 'mf-manifest.json': 'sha384-AAAA' } },
    maxBuilds: 5,
    ...overrides,
  }
}

function setup(overrides: Partial<RuntimeDeps> = {}) {
  const fail = new Set<string>()
  let current = ''
  let clock = 0
  const instance: FederationInstance = {
    registerRemotes(remotes) {
      current = remotes[0]!.entry
    },
    registerShared() {},
    async loadRemote() {
      if (fail.has(current)) throw new Error(`down: ${current}`)
      return { default: () => null, entry: current } as never
    },
  }
  const runtime = createComponentRuntime({
    isServer: true,
    react: fakeReact,
    hostShared: { react: { version: '19.3.1', module: fakeReact } },
    createInstance: () => instance,
    serverPlugin: () => ({ name: 'test-server-plugin' }),
    canLoadServerCode: () => true,
    isTrusted: () => true,
    now: () => clock,
    sleep: async () => {},
    emit: () => {},
    ...overrides,
  })
  return { runtime, fail, tick: (ms: number) => (clock += ms) }
}

beforeEach(() => {
  rs.spyOn(console, 'error').mockImplementation(() => {})
  rs.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  rs.restoreAllMocks()
})

test('classifyOutcome maps each block reason', () => {
  const browserOnly: ServerBlock[] = [
    'unverified',
    'untrusted',
    'node',
    'react',
    'stale',
    'unisolated',
    'scopes',
  ]
  for (const block of browserOnly) {
    expect(classifyOutcome({ kind: 'blocked', block, code: 'NF-028' })).toEqual(
      { state: 'browser-only', code: 'NF-028' }
    )
  }
  for (const block of ['nested-remotes', 'unchecked'] as const) {
    expect(classifyOutcome({ kind: 'blocked', block, code: 'NF-028' })).toEqual(
      { state: 'refused', code: 'NF-028' }
    )
  }
})

test('classifyOutcome maps errors', () => {
  const of = (code: 'NF-027' | 'NF-036' | 'NF-030' | 'NF-029') =>
    classifyOutcome({ kind: 'error', code, error: new Error(code) })
  expect(of('NF-027')).toEqual({ state: 'refused', code: 'NF-027' })
  expect(of('NF-036')).toEqual({ state: 'refused', code: 'NF-036' })
  expect(of('NF-030')).toEqual({ state: 'browser-only', code: 'NF-030' })
  expect(of('NF-029')).toEqual({ state: 'failed', code: 'NF-029' })
})

test('classifyOutcome maps loaded', () => {
  expect(classifyOutcome({ kind: 'loaded' })).toEqual({ state: 'ready' })
})

describe('serverOutcome records why a load returned null', () => {
  test('undefined before any load, loaded on success', async () => {
    const { runtime } = setup()
    const d = descriptor('c1')
    expect(runtime.serverOutcome(d, './Counter')).toBeUndefined()
    const p = runtime.serverLoad(d, './Counter')
    expect(runtime.serverOutcome(d, './Counter')).toBeUndefined()
    expect(await p).not.toBeNull()
    expect(runtime.serverOutcome(d, './Counter')).toEqual({ kind: 'loaded' })
  })

  test('an integrity rejection gives NF-027', async () => {
    const { runtime } = setup()
    const good = descriptor('c1')
    const p = runtime.load(good, './Counter')
    const forged = descriptor('c1', {
      ssr: { integrity: { 'mf-manifest.json': 'sha384-EVIL' } },
    })
    expect(await runtime.serverLoad(forged, './Other')).toBeNull()
    await p
    expect(runtime.serverOutcome(forged, './Other')).toMatchObject({
      kind: 'error',
      code: 'NF-027',
    })
  })

  test('an unmet shared module gives NF-036, not the NF-028 wrapping', async () => {
    const { runtime } = setup()
    const d = descriptor('c1', {
      shared: { 'next/link': { requiredVersion: false, fallback: false } },
    })
    expect(await runtime.serverLoad(d, './NavLink')).toBeNull()
    expect(runtime.serverOutcome(d, './NavLink')).toMatchObject({
      kind: 'error',
      code: 'NF-036',
    })
  })

  test('a fetch failure gives NF-029', async () => {
    const { runtime, fail } = setup()
    const d = descriptor('c1')
    fail.add(d.manifest)
    expect(await runtime.serverLoad(d, './Counter')).toBeNull()
    expect(runtime.serverOutcome(d, './Counter')).toMatchObject({
      kind: 'error',
      code: 'NF-029',
    })
  })

  test('a pre-load block records the block reason', async () => {
    const { runtime } = setup({ isTrusted: () => false })
    const d = descriptor('c1')
    expect(await runtime.serverLoad(d, './Counter')).toBeNull()
    expect(runtime.serverOutcome(d, './Counter')).toEqual({
      kind: 'blocked',
      block: 'untrusted',
      code: 'NF-028',
    })
  })
})

test('a cooldown hit replays the stored outcome', async () => {
  const { runtime, fail, tick } = setup()
  const d = descriptor('c1')
  fail.add(d.manifest)
  const first = runtime.serverLoad(d, './Counter')
  expect(await first).toBeNull()
  tick(500)
  expect(runtime.serverLoad(d, './Counter')).toBe(first)
  expect(runtime.serverOutcome(d, './Counter')).toMatchObject({
    kind: 'error',
    code: 'NF-029',
  })
})
