import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import { classifyOutcome } from '../src/components/preload-result.ts'
import { createBindings } from '../src/components/render.tsx'
import type { BindingsRuntime } from '../src/components/render.tsx'
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
  type Scope = {
    globals: Record<string, unknown>
    blocked: Map<string, ServerBlock>
  }
  let scope: Scope | undefined
  const hooks: {
    onLoad?: (scope: Scope, entry: string) => void
    wait?: Promise<void>
  } = {}
  const instance: FederationInstance = {
    registerRemotes(remotes) {
      current = remotes[0]!.entry
    },
    registerShared() {},
    async loadRemote() {
      hooks.onLoad?.(scope!, current)
      if (hooks.wait) await hooks.wait
      if (fail.has(current)) throw new Error(`down: ${current}`)
      return { default: () => null, entry: current } as never
    },
  }
  const runtime = createComponentRuntime({
    isServer: true,
    react: fakeReact,
    hostShared: { react: { version: '19.3.1', module: fakeReact } },
    createInstance: () => instance,
    serverPlugin: (_integrityFor, s) => {
      scope = s as unknown as Scope
      return { name: 'test-server-plugin' }
    },
    canLoadServerCode: () => true,
    isTrusted: () => true,
    now: () => clock,
    sleep: async () => {},
    emit: () => {},
    ...overrides,
  })
  return { runtime, fail, hooks, tick: (ms: number) => (clock += ms) }
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

  test('a loader refusal during the load records its block reason: refused', async () => {
    const { runtime, hooks } = setup()
    const d = descriptor('c1')
    hooks.onLoad = (scope) => {
      // The server loader refuses a manifest that lists remotes of its own.
      scope.blocked.set(d.base, 'nested-remotes')
      throw new Error('refused by the loader')
    }
    expect(await runtime.serverLoad(d, './Counter')).toBeNull()
    const outcome = runtime.serverOutcome(d, './Counter')
    expect(outcome).toEqual({
      kind: 'blocked',
      block: 'nested-remotes',
      code: 'NF-028',
    })
    expect(classifyOutcome(outcome!)).toEqual({
      state: 'refused',
      code: 'NF-028',
    })
  })

  test('a post-load block records the block reason', async () => {
    const { runtime, hooks } = setup()
    const d = descriptor('c1')
    const otherReact = { useState: () => 'other', version: '19.3.1' }
    hooks.onLoad = (scope) => {
      // Another React reached this runtime's share cache during the load.
      scope.globals.__mf_module_cache__ = { share: { react: otherReact } }
    }
    expect(await runtime.serverLoad(d, './Counter')).toBeNull()
    expect(runtime.serverOutcome(d, './Counter')).toEqual({
      kind: 'blocked',
      block: 'react',
      code: 'NF-028',
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
  fail.clear()
  tick(500) // serverRetryMs (1000) since the failure
  expect(await runtime.serverLoad(d, './Counter')).not.toBeNull()
  expect(runtime.serverOutcome(d, './Counter')).toEqual({ kind: 'loaded' })
})

describe('preloadRemoteComponent with options', () => {
  function server(overrides: Partial<RuntimeDeps> = {}) {
    const s = setup(overrides)
    return {
      ...s,
      bindings: createBindings({ runtime: s.runtime, isServer: true }),
    }
  }

  test('preload without options resolves undefined', async () => {
    const { bindings } = server()
    await expect(
      bindings.preloadRemoteComponent(descriptor('c1'), './Counter')
    ).resolves.toBeUndefined()
    await expect(
      bindings.preloadRemoteComponent(null, './Counter')
    ).resolves.toBeUndefined()
  })

  test('null descriptor gives no-descriptor', async () => {
    const { bindings } = server()
    const r = await bindings.preloadRemoteComponent(null, './Counter', {
      timeoutMs: 100,
    })
    expect(r).toEqual({ state: 'no-descriptor', ms: expect.any(Number) })
  })

  test('server ready gives remote, buildId, expose and ms', async () => {
    const { bindings } = server()
    const r = await bindings.preloadRemoteComponent(
      descriptor('c1'),
      './Counter',
      {
        timeoutMs: 1000,
      }
    )
    expect(r).toEqual({
      state: 'ready',
      remote: 'components',
      buildId: 'c1',
      expose: './Counter',
      ms: expect.any(Number),
    })
    expect(r.ms).toBeGreaterThanOrEqual(0)
  })

  test('server integrity failure gives refused NF-027', async () => {
    const { runtime, bindings } = server()
    const p = runtime.load(descriptor('c1'), './Counter')
    const forged = descriptor('c1', {
      ssr: { integrity: { 'mf-manifest.json': 'sha384-EVIL' } },
    })
    const r = await bindings.preloadRemoteComponent(forged, './Other', {
      timeoutMs: 1000,
    })
    await p
    expect(r).toMatchObject({ state: 'refused', code: 'NF-027' })
  })

  test('a pending load past timeoutMs gives timeout', async () => {
    const { bindings, hooks } = server()
    let release!: () => void
    hooks.wait = new Promise((resolve) => (release = resolve))
    const r = await bindings.preloadRemoteComponent(
      descriptor('c1'),
      './Counter',
      {
        timeoutMs: 10,
      }
    )
    expect(r).toMatchObject({
      state: 'timeout',
      remote: 'components',
      buildId: 'c1',
      expose: './Counter',
    })
    release()
  })

  test('timeout does not cancel the load', async () => {
    const { bindings, hooks } = server()
    let release!: () => void
    hooks.wait = new Promise((resolve) => (release = resolve))
    const d = descriptor('c1')
    const a = await bindings.preloadRemoteComponent(d, './Counter', {
      timeoutMs: 10,
    })
    expect(a.state).toBe('timeout')
    const b = bindings.preloadRemoteComponent(d, './Counter', {
      timeoutMs: 5000,
    })
    release()
    expect((await b).state).toBe('ready')
  })

  test('a caller timeout above loadTimeoutMs gives failed NF-029', async () => {
    const { bindings, hooks } = server({ loadTimeoutMs: 20 })
    hooks.wait = new Promise(() => {})
    const r = await bindings.preloadRemoteComponent(
      descriptor('c1'),
      './Counter',
      {
        timeoutMs: 2000,
      }
    )
    expect(r).toMatchObject({ state: 'failed', code: 'NF-029' })
  })
})

describe('browser preload with options', () => {
  function browser(load: () => PromiseLike<unknown>) {
    const runtime = {
      load,
      serverLoad: () => {
        throw new Error('serverLoad in the browser')
      },
      serverBlock: () => undefined,
      serverOutcome: () => {
        throw new Error('serverOutcome in the browser')
      },
      registerShared: () => {},
    } as unknown as BindingsRuntime
    return createBindings({ runtime, isServer: false })
  }
  const d = descriptor('c1')
  const opts = { timeoutMs: 50 }

  test('ready', async () => {
    const b = browser(async () => ({ default: () => null }) as never)
    expect(await b.preloadRemoteComponent(d, './Counter', opts)).toMatchObject({
      state: 'ready',
      buildId: 'c1',
    })
  })

  test('NF-036 gives refused, never browser-only', async () => {
    const b = browser(() => Promise.reject(new NFError('NF-036', 'unmet')))
    expect(await b.preloadRemoteComponent(d, './Counter', opts)).toMatchObject({
      state: 'refused',
      code: 'NF-036',
    })
  })

  test('other NF codes give failed, even ones that are browser-only on the server', async () => {
    for (const code of ['NF-029', 'NF-028', 'NF-030'] as const) {
      const b = browser(() => Promise.reject(new NFError(code, 'x')))
      expect(
        await b.preloadRemoteComponent(d, './Counter', opts)
      ).toMatchObject({
        state: 'failed',
        code,
      })
    }
  })

  test('a non-NF error gives failed NF-029', async () => {
    const b = browser(() => Promise.reject(new Error('boom')))
    expect(await b.preloadRemoteComponent(d, './Counter', opts)).toMatchObject({
      state: 'failed',
      code: 'NF-029',
    })
  })

  test('timeout, and a later rejection is not unhandled', async () => {
    let reject!: (e: unknown) => void
    const b = browser(() => new Promise((_, r) => (reject = r)))
    expect((await b.preloadRemoteComponent(d, './Counter', opts)).state).toBe(
      'timeout'
    )
    reject(new NFError('NF-029', 'late'))
    await new Promise((r) => setTimeout(r, 0))
  })

  test('no-descriptor', async () => {
    const b = browser(async () => ({}) as never)
    expect(
      (await b.preloadRemoteComponent(null, './Counter', opts)).state
    ).toBe('no-descriptor')
  })
})

describe('a runtime that throws synchronously never rejects the preload', () => {
  function bindingsFor(isServer: boolean, error: unknown) {
    const throws = () => {
      throw error
    }
    const runtime = {
      load: throws,
      serverLoad: throws,
      serverBlock: () => undefined,
      serverOutcome: () => undefined,
      registerShared: () => {},
    } as unknown as BindingsRuntime
    return createBindings({ runtime, isServer })
  }
  const d = descriptor('c1')

  for (const isServer of [false, true]) {
    const side = isServer ? 'server' : 'browser'
    test(`${side}: with options it settles failed with the error's code or NF-029`, async () => {
      expect(
        await bindingsFor(isServer, new NFError('NF-028', 'x')).preloadRemoteComponent(
          d,
          './Counter',
          { timeoutMs: 50 }
        )
      ).toMatchObject({ state: 'failed', code: 'NF-028' })
      expect(
        await bindingsFor(isServer, new Error('boom')).preloadRemoteComponent(
          d,
          './Counter',
          { timeoutMs: 50 }
        )
      ).toMatchObject({ state: 'failed', code: 'NF-029' })
    })

    test(`${side}: without options it resolves undefined`, async () => {
      await expect(
        bindingsFor(isServer, new Error('boom')).preloadRemoteComponent(
          d,
          './Counter'
        )
      ).resolves.toBeUndefined()
    })
  }

  test('browser: a synchronous NF-036 maps to refused like a rejection', async () => {
    expect(
      await bindingsFor(false, new NFError('NF-036', 'unmet')).preloadRemoteComponent(
        d,
        './Counter',
        { timeoutMs: 50 }
      )
    ).toMatchObject({ state: 'refused', code: 'NF-036' })
  })
})
