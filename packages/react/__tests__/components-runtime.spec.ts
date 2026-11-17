import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import {
  MAX_SCOPES,
  createComponentRuntime,
} from '../src/components/runtime.ts'
import type {
  FederationInstance,
  RuntimeDeps,
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

type Fake = FederationInstance & {
  registrations: Array<{ entry: string; force: boolean }>
  loads: string[]
  fail: Set<string>
  shared: Array<Record<string, unknown>>
  plugins: unknown[]
}

function fakeInstance(): Fake {
  let current = ''
  const fake: Fake = {
    registrations: [],
    loads: [],
    fail: new Set(),
    shared: [],
    plugins: [],
    registerRemotes(remotes, options) {
      current = remotes[0]!.entry
      fake.registrations.push({
        entry: current,
        force: options?.force === true,
      })
    },
    registerShared(shared) {
      fake.shared.push(shared)
    },
    async loadRemote(id) {
      fake.loads.push(`${current} ${id}`)
      if (fake.fail.has(current)) throw new Error(`down: ${current}`)
      return { default: () => null, entry: current } as never
    },
  }
  return fake
}

type Scope = {
  id: string
  layer: string
  globals: Record<string, unknown>
  blocked: Map<string, unknown>
}

function setup(overrides: Partial<RuntimeDeps> = {}) {
  const instance = fakeInstance()
  const scopes: Scope[] = []
  let clock = 0
  const sleeps: number[] = []
  const events: unknown[] = []
  const runtime = createComponentRuntime({
    isServer: true,
    react: fakeReact,
    hostShared: { react: { version: '19.3.1', module: fakeReact } },
    createInstance: (options) => {
      instance.plugins.push(...(options.plugins ?? []))
      instance.shared.push(options.shared)
      return instance
    },
    serverPlugin: (_integrityFor, scope) => {
      scopes.push(scope)
      return { name: 'test-server-plugin' }
    },
    canLoadServerCode: () => true,
    isTrusted: () => true,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    emit: (event) => events.push(event),
    ...overrides,
  })
  return {
    runtime,
    instance,
    sleeps,
    events,
    tick: (ms: number) => (clock += ms),
    /** Server: the runtime's current MF scope (its latest instance's). */
    scope: () => scopes[scopes.length - 1]!,
    scopes,
  }
}

/** A server runtime whose MF scope exists (one load done). */
async function loaded(overrides: Partial<RuntimeDeps> = {}) {
  const ctx = setup(overrides)
  await ctx.runtime.load(descriptor('c0'), './Counter')
  return ctx
}

const settle = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    () => 'failed'
  )

afterEach(() => {
  delete (globalThis as { __mf_module_cache__?: unknown }).__mf_module_cache__
  rs.restoreAllMocks()
})

test('the host React and its own modules are registered as shared, plus extras', async () => {
  const { runtime, instance } = setup()
  runtime.registerShared({
    'components-context': { version: '1.0.0', module: {} },
  })
  await runtime.load(descriptor('c1'), './Counter')
  const first = instance.shared[0] as Record<
    string,
    { lib: () => unknown; shareConfig: unknown }
  >
  expect(first.react!.lib()).toBe(fakeReact)
  expect(first.react!.shareConfig).toEqual({
    singleton: true,
    requiredVersion: false,
  })
  expect(Object.keys(instance.shared[1]!)).toEqual(['components-context'])
  expect(instance.plugins).toEqual([{ name: 'test-server-plugin' }])
})

test('one load per build and expose; a fulfilled thenable is readable synchronously', async () => {
  const { runtime, instance } = setup()
  const a = runtime.load(descriptor('c1'), './Counter')
  expect(runtime.load(descriptor('c1'), './Counter')).toBe(a)
  expect(a.status).toBe('pending')
  await a
  expect(a.status).toBe('fulfilled')
  expect(a.value).toMatchObject({ entry: descriptor('c1').manifest })
  expect(instance.loads).toEqual([
    `${descriptor('c1').manifest} components/Counter`,
  ])
})

test('a build change re-registers the remote with force; the old build stays cached', async () => {
  const { runtime, instance } = setup()
  await runtime.load(descriptor('c1'), './Counter')
  await runtime.load(descriptor('c2'), './Counter')
  expect(instance.registrations).toEqual([
    { entry: descriptor('c1').manifest, force: true },
    { entry: descriptor('c2').manifest, force: true },
  ])
  // c1 is still loaded: no new registration or load.
  const again = runtime.load(descriptor('c1'), './Counter')
  expect(again.status).toBe('fulfilled')
  expect(instance.loads).toHaveLength(2)
})

test('loads of different builds never interleave (skew safety)', async () => {
  const { runtime, instance } = setup()
  const order: string[] = []
  const original = instance.loadRemote.bind(instance)
  instance.loadRemote = async (id) => {
    const entry = instance.registrations.at(-1)!.entry
    order.push(`start ${entry}`)
    await new Promise((r) => setTimeout(r, 5))
    const mod = (await original(id)) as { entry: string }
    order.push(`end ${entry}`)
    expect(mod.entry).toBe(entry)
    return mod as never
  }
  await Promise.all([
    runtime.load(descriptor('c1'), './Counter'),
    runtime.load(descriptor('c2'), './Counter'),
  ])
  expect(order).toEqual([
    `start ${descriptor('c1').manifest}`,
    `end ${descriptor('c1').manifest}`,
    `start ${descriptor('c2').manifest}`,
    `end ${descriptor('c2').manifest}`,
  ])
})

test('build cap: at most maxBuilds builds per remote stay loaded, oldest evicted', async () => {
  const { runtime } = setup()
  for (const id of ['c1', 'c2', 'c3']) {
    await runtime.load(descriptor(id, { maxBuilds: 2 }), './Counter')
  }
  expect(runtime.loadedBuilds('components')).toEqual(['c2', 'c3'])
  // Using c2 makes it the most recent: c3 is evicted next.
  await runtime.load(descriptor('c2', { maxBuilds: 2 }), './Counter')
  await runtime.load(descriptor('c4', { maxBuilds: 2 }), './Counter')
  expect(runtime.loadedBuilds('components')).toEqual(['c2', 'c4'])
})

test('default cap is 5 builds', async () => {
  const { runtime } = setup()
  for (let i = 1; i <= 7; i++)
    await runtime.load(descriptor(`c${i}`), './Counter')
  expect(runtime.loadedBuilds('components')).toEqual([
    'c3',
    'c4',
    'c5',
    'c6',
    'c7',
  ])
})

test('server: a rejected thenable is kept (no retry loop) until the cooldown passes', async () => {
  const { runtime, instance, tick } = setup()
  instance.fail.add(descriptor('c1').manifest)
  const first = runtime.load(descriptor('c1'), './Counter')
  expect(await settle(first)).toBe('failed')
  expect(first.status).toBe('rejected')
  // React re-renders after a rejection: the same thenable comes back.
  for (let i = 0; i < 50; i++) {
    expect(runtime.load(descriptor('c1'), './Counter')).toBe(first)
  }
  expect(instance.loads).toHaveLength(1)
  tick(999)
  expect(runtime.load(descriptor('c1'), './Counter')).toBe(first)
  tick(1)
  instance.fail.clear()
  const retry = runtime.load(descriptor('c1'), './Counter')
  expect(retry).not.toBe(first)
  expect(await settle(retry)).toBe('ok')
  // The retry re-registers the remote with force (a clean MF cache).
  expect(instance.registrations.at(-1)).toEqual({
    entry: descriptor('c1').manifest,
    force: true,
  })
})

test('client: retries with a bounded backoff inside one pending thenable, then rejects for good', async () => {
  const { runtime, instance, sleeps, events } = setup({ isServer: false })
  instance.fail.add(descriptor('c1').manifest)
  const p = runtime.load(descriptor('c1'), './Counter')
  expect(p.status).toBe('pending')
  expect(await settle(p)).toBe('failed')
  expect(sleeps).toEqual([500, 1000, 2000])
  expect(instance.loads).toHaveLength(4)
  expect(p.status).toBe('rejected')
  // Never retried within the page.
  expect(runtime.load(descriptor('c1'), './Counter')).toBe(p)
  expect(instance.loads).toHaveLength(4)
  expect(events).toEqual([
    expect.objectContaining({
      type: 'component:error',
      remote: 'components',
      buildId: 'c1',
      expose: './Counter',
      code: 'NF-029',
    }),
  ])
})

test('client: a retry that succeeds resolves the same thenable', async () => {
  const { runtime, instance, events } = setup({ isServer: false })
  instance.fail.add(descriptor('c1').manifest)
  const p = runtime.load(descriptor('c1'), './Counter')
  await Promise.resolve()
  instance.fail.clear()
  expect(await settle(p)).toBe('ok')
  expect(events).toEqual([
    expect.objectContaining({ type: 'component:load', buildId: 'c1' }),
  ])
})

test('a module without a default export is a load failure (NF-029)', async () => {
  const { runtime, instance } = setup()
  instance.loadRemote = async () => ({ notDefault: 1 }) as never
  const p = runtime.load(descriptor('c1'), './Counter')
  await expect(p).rejects.toMatchObject({ code: 'NF-029' })
})

test('server: the verified integrity of each loaded build is what the loader checks', async () => {
  let lookup: ((url: string) => unknown) | undefined
  const { runtime } = setup({
    serverPlugin: (integrityFor) => {
      lookup = integrityFor
      return { name: 'p' }
    },
  })
  await runtime.load(descriptor('c1'), './Counter')
  expect(lookup!(`${descriptor('c1').base}remoteEntry.ssr.js`)).toEqual({
    base: descriptor('c1').base,
    integrity: descriptor('c1').ssr!.integrity,
  })
  expect(
    lookup!('http://127.0.0.1:4110/b/other/remoteEntry.ssr.js')
  ).toBeUndefined()
})

test('serverBlock: unverified builds, Node without getBuiltinModule, and a second React', async () => {
  const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
  const { runtime, scope } = await loaded()
  expect(runtime.serverBlock(descriptor('c1'))).toBeNull()
  expect(runtime.serverBlock(descriptor('c1', { ssr: null }))).toBe(
    'unverified'
  )

  const old = setup({ canLoadServerCode: () => false }).runtime
  expect(old.serverBlock(descriptor('c1'))).toBe('node')
  expect(old.serverBlock(descriptor('c2'))).toBe('node')

  // MF vite's process-wide share cache (first writer wins) holds another
  // layer's React: this runtime never reads it.
  ;(globalThis as { __mf_module_cache__?: unknown }).__mf_module_cache__ = {
    share: { react: { useState: () => 'other' } },
  }
  expect(runtime.serverBlock(descriptor('c1'))).toBeNull()
  // Its own cache (its scope) with another React: browser-only.
  scope().globals.__mf_module_cache__ = {
    share: { react: { useState: () => 'other' } },
  }
  expect(runtime.serverBlock(descriptor('c1'))).toBe('react')
  expect(runtime.serverBlock(descriptor('c2'))).toBe('react')
  scope().globals.__mf_module_cache__ = { share: { react: fakeReact } }
  expect(runtime.serverBlock(descriptor('c1'))).toBeNull()
  // Warned once per reason, not per render.
  const lines = warn.mock.calls.map((c) => c.join(' '))
  expect(
    lines.filter((l) => /NF-028/.test(l) && /20\.16/.test(l))
  ).toHaveLength(1)
  expect(lines.filter((l) => /NF-028/.test(l) && /React/.test(l))).toHaveLength(
    1
  )
})

test("serverBlock: a host module that is stale in the runtime's share cache blocks SSR", async () => {
  const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
  const context = { HostContext: {} }
  const { runtime, scope } = await loaded()
  runtime.registerShared({
    'components-context': { version: '1.0.0', module: context },
  })
  // A module registered late: the runtime starts over in a new scope.
  await runtime.load(descriptor('c1'), './Counter')
  scope().globals.__mf_module_cache__ = {
    share: { 'default:components-context': context, react: fakeReact },
  }
  expect(runtime.serverBlock(descriptor('c1'))).toBeNull()
  // The process-wide cache is never read on the server.
  ;(globalThis as { __mf_module_cache__?: unknown }).__mf_module_cache__ = {
    share: { 'components-context': { HostContext: {} } },
  }
  expect(runtime.serverBlock(descriptor('c1'))).toBeNull()
  // Its own cache kept an older instance of the same module (first writer wins).
  scope().globals.__mf_module_cache__ = {
    share: { 'components-context': { HostContext: {} } },
  }
  expect(runtime.serverBlock(descriptor('c1'))).toBe('stale')
  expect(runtime.serverBlock(descriptor('c2'))).toBe('stale')
  const lines = warn.mock.calls.map((c) => c.join(' '))
  expect(
    lines.filter((l) => /NF-028.*components-context/.test(l))
  ).toHaveLength(1)
})

test('every registration forces: MF may hold another build of the container from an earlier runtime copy', async () => {
  const { runtime, instance } = setup()
  await runtime.load(descriptor('c1'), './Counter')
  expect(instance.registrations[0]).toEqual({
    entry: descriptor('c1').manifest,
    force: true,
  })
})

describe('fix round 1', () => {
  // An MF-like instance: loadRemote reads the registered entry, waits for a
  // gate, then fills its module cache by container name (as MF does).
  function gatedInstances() {
    const instances: Array<{ gates: Map<string, () => void> }> = []
    const gates = new Map<string, () => void>()
    const create = () => {
      let entry = ''
      const moduleCache = new Map<
        string,
        { default: () => null; entry: string }
      >()
      const inst: FederationInstance & { gates: Map<string, () => void> } = {
        gates,
        registerRemotes(remotes) {
          entry = remotes[0]!.entry
          moduleCache.delete(remotes[0]!.name)
        },
        registerShared() {},
        async loadRemote(id) {
          const name = id.split('/')[0]!
          const mine = entry
          await new Promise<void>((resolve) => gates.set(mine, resolve))
          if (!moduleCache.has(name)) {
            moduleCache.set(name, { default: () => null, entry: mine })
          }
          return moduleCache.get(name) as never
        },
      }
      instances.push(inst)
      return inst
    }
    return { instances, gates, create }
  }

  test('R1: a timed-out load cannot leak its module into the next build (fresh MF instance)', async () => {
    const { instances, gates, create } = gatedInstances()
    const runtime = createComponentRuntime({
      isServer: true,
      react: fakeReact,
      hostShared: {},
      createInstance: create,
      canLoadServerCode: () => true,
      isTrusted: () => true,
      loadTimeoutMs: 30,
    })
    const r1 = runtime.load(descriptor('r1'), './Counter')
    await expect(r1).rejects.toMatchObject({ code: 'NF-029' })
    const r2 = runtime.load(descriptor('r2'), './Counter')
    await new Promise((r) => setTimeout(r, 5))
    // The abandoned r1 load finishes first, then r2.
    gates.get(descriptor('r1').manifest)!()
    await new Promise((r) => setTimeout(r, 5))
    gates.get(descriptor('r2').manifest)!()
    expect(((await r2) as unknown as { entry: string }).entry).toBe(
      descriptor('r2').manifest
    )
    expect(instances).toHaveLength(2)
  })

  test("R2: another layer's React in the process-wide cache meanwhile does not block (overlapping first loads)", async () => {
    const otherReact = { useState: () => 'other', version: '19.3.1' }
    const { runtime } = setup()
    const load = runtime.serverLoad(descriptor('c1'), './Counter')
    ;(globalThis as { __mf_module_cache__?: unknown }).__mf_module_cache__ = {
      share: { react: otherReact },
    }
    expect(await load).not.toBeNull()
  })

  test("R2: the runtime's own share cache is checked again after the load", async () => {
    const otherReact = { useState: () => 'other', version: '19.3.1' }
    const { runtime, instance, scope } = setup()
    instance.loadRemote = async () => {
      // A copy of another React reached this runtime's cache meanwhile.
      scope().globals.__mf_module_cache__ = { share: { react: otherReact } }
      return { default: () => null } as never
    }
    rs.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await runtime.serverLoad(descriptor('c1'), './Counter')).toBeNull()
  })

  test('S1: a descriptor the server cannot trust never reaches the MF runtime', async () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    const { runtime, instance } = setup({ isTrusted: () => false })
    let evaluated = false
    instance.loadRemote = async () => {
      evaluated = true
      return { default: () => null } as never
    }
    expect(runtime.serverBlock(descriptor('c1'))).toBe('untrusted')
    expect(await runtime.serverLoad(descriptor('c1'), './Counter')).toBeNull()
    await new Promise((r) => setTimeout(r, 5))
    expect(evaluated).toBe(false)
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/NF-028/)
  })

  test('the process-wide registry records a build the server loaded, or refused, for static regenerations', async () => {
    const registry = componentTrustRegistry()
    registry.serverReady?.clear()
    const { runtime, instance } = setup()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const original = instance.loadRemote.bind(instance)
    instance.loadRemote = async (id) => {
      await gate
      return original(id)
    }
    const load = runtime.serverLoad(descriptor('c1'), './Counter')
    // Still loading: not ready (a render now would show its fallback).
    expect(registry.serverReady?.get(descriptor('c1').base)).toBeUndefined()
    release()
    expect(await load).not.toBeNull()
    expect(registry.serverReady?.get(descriptor('c1').base)).toBe('loaded')
    rs.spyOn(console, 'warn').mockImplementation(() => {})
    const refusing = setup({ isTrusted: () => false })
    await refusing.runtime.serverLoad(descriptor('c2'), './Counter')
    expect(registry.serverReady?.get(descriptor('c2').base)).toBe('refused')
  })

  test('S1: a second descriptor for a loading base cannot replace its integrity map', async () => {
    let lookup: ((url: string) => unknown) | undefined
    const { runtime } = setup({
      serverPlugin: (integrityFor) => {
        lookup = integrityFor
        return { name: 'p' }
      },
    })
    const good = descriptor('c1')
    const p = runtime.load(good, './Counter')
    const forged = descriptor('c1', {
      ssr: { integrity: { 'mf-manifest.json': 'sha384-EVIL' } },
    })
    await expect(runtime.load(forged, './Other')).rejects.toMatchObject({
      code: 'NF-027',
    })
    await p
    expect(lookup!(`${good.base}mf-manifest.json`)).toEqual({
      base: good.base,
      integrity: good.ssr!.integrity,
    })
  })

  test('integrityFor picks the longest matching base', async () => {
    let lookup: ((url: string) => unknown) | undefined
    const { runtime } = setup({
      serverPlugin: (integrityFor) => {
        lookup = integrityFor
        return { name: 'p' }
      },
    })
    const outer = descriptor('x', {
      base: 'http://h/b/',
      manifest: 'http://h/b/m.json',
    })
    const inner = descriptor('y', {
      base: 'http://h/b/y/',
      manifest: 'http://h/b/y/m.json',
      ssr: { integrity: { 'm.json': 'sha384-YYYY' } },
    })
    await runtime.load(outer, './Counter')
    await runtime.load(inner, './Counter')
    expect((lookup!('http://h/b/y/m.json') as { base: string }).base).toBe(
      'http://h/b/y/'
    )
  })

  test('server cooldown: a re-render with the same descriptor object reuses its result', async () => {
    const { runtime, instance, tick } = setup()
    instance.fail.add(descriptor('c1').manifest)
    const d = descriptor('c1')
    const first = runtime.serverLoad(d, './Counter')
    expect(await first).toBeNull()
    // Same render (no time passed): the same result.
    expect(runtime.serverLoad(d, './Counter')).toBe(first)
    tick(5000)
    // A new render (a new descriptor object) retries after the cooldown.
    expect(runtime.serverLoad(descriptor('c1'), './Counter')).not.toBe(first)
  })

  test('evict never drops the integrity map of a build that is still loading', async () => {
    let lookup: ((url: string) => unknown) | undefined
    const { runtime, instance } = setup({
      serverPlugin: (integrityFor) => {
        lookup = integrityFor
        return { name: 'p' }
      },
    })
    let release!: () => void
    const original = instance.loadRemote.bind(instance)
    instance.loadRemote = async (id) => {
      if (instance.registrations.at(-1)!.entry === descriptor('c1').manifest) {
        await new Promise<void>((r) => (release = r))
      }
      return original(id)
    }
    const slow = runtime.load(descriptor('c1', { maxBuilds: 1 }), './Counter')
    void runtime.load(descriptor('c2', { maxBuilds: 1 }), './Counter')
    await new Promise((r) => setTimeout(r, 5))
    expect(lookup).toBeDefined()
    expect(lookup!(`${descriptor('c1').base}mf-manifest.json`)).toBeDefined()
    release()
    await slow
  })

  test('maxBuilds below 1 is treated as 1 (no endless eviction)', async () => {
    const { runtime } = setup()
    await runtime.load(descriptor('c1', { maxBuilds: -3 }), './Counter')
    await runtime.load(descriptor('c2', { maxBuilds: 0 }), './Counter')
    expect(runtime.loadedBuilds('components')).toEqual(['c2'])
  })

  test('R3: browser retries import the remote entry under a new URL', async () => {
    const imported: string[] = []
    let plugin:
      | { loadEntry: (a: { remoteInfo: { entry: string } }) => unknown }
      | undefined
    const instance = fakeInstance()
    const runtime = createComponentRuntime({
      isServer: false,
      react: fakeReact,
      hostShared: {},
      createInstance: (options) => {
        plugin = options.plugins[0] as typeof plugin
        return instance
      },
      canLoadServerCode: () => false,
      sleep: async () => {},
      importEntry: async (url) => {
        imported.push(url)
        throw new Error('still down')
      },
    })
    const entry = `${descriptor('c1').base}remoteEntry.js`
    instance.loadRemote = async () => {
      const result = await plugin!.loadEntry({ remoteInfo: { entry } })
      if (result === undefined)
        throw new Error('first attempt: MF default import failed')
      return result as never
    }
    await expect(
      runtime.load(descriptor('c1'), './Counter')
    ).rejects.toBeDefined()
    expect(imported).toEqual([
      `${entry}?nf_retry=1`,
      `${entry}?nf_retry=2`,
      `${entry}?nf_retry=3`,
    ])
  })
})

describe('fix round 2', () => {
  test('1: without getBuiltinModule the Node check runs first (isTrusted is never called)', () => {
    rs.spyOn(console, 'warn').mockImplementation(() => {})
    const { runtime } = setup({
      canLoadServerCode: () => false,
      isTrusted: () => {
        throw new TypeError('process.getBuiltinModule is not a function')
      },
    })
    expect(runtime.serverBlock(descriptor('c1'))).toBe('node')
  })

  test('2: extra shared modules are registered again on the instance created after a timeout', async () => {
    const created: Fake[] = []
    let n = 0
    const runtime = createComponentRuntime({
      isServer: true,
      react: fakeReact,
      hostShared: { react: { version: '19.3.1', module: fakeReact } },
      createInstance: (options) => {
        const inst = fakeInstance()
        inst.shared.push(options.shared)
        const first = n++ === 0
        if (first) inst.loadRemote = () => new Promise(() => {})
        created.push(inst)
        return inst
      },
      canLoadServerCode: () => true,
      isTrusted: () => true,
      loadTimeoutMs: 20,
    })
    runtime.registerShared({
      'components-context': { version: '1.0.0', module: {} },
    })
    await expect(
      runtime.load(descriptor('c1'), './Counter')
    ).rejects.toBeDefined()
    await runtime.load(descriptor('c2'), './Counter')
    expect(created).toHaveLength(2)
    for (const inst of created) {
      expect(inst.shared.flatMap((s) => Object.keys(s))).toContain(
        'components-context'
      )
    }
  })

  test('8: a reused descriptor object retries a failed load after the cooldown (next request)', async () => {
    const { runtime, instance, tick } = setup()
    instance.fail.add(descriptor('c1').manifest)
    const d = descriptor('c1')
    const first = runtime.serverLoad(d, './Counter')
    expect(await first).toBeNull()
    // Same render (no time passed): same result.
    expect(runtime.serverLoad(d, './Counter')).toBe(first)
    instance.fail.clear()
    tick(1000)
    const again = runtime.serverLoad(d, './Counter')
    expect(again).not.toBe(first)
    expect(await again).toMatchObject({ entry: d.manifest })
  })
})

describe('shared modules: version negotiation (NF-036)', () => {
  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: { code?: string; message?: string }) => e.code ?? e.message
    )
  const shared = (
    entries: RemoteComponentDescriptor['shared']
  ): Partial<RemoteComponentDescriptor> => ({ shared: entries })

  test('a module the host does not provide (no fallback) refuses the load before MF runs', async () => {
    const { runtime, instance, events, sleeps } = setup({ isServer: false })
    const d = descriptor(
      'c1',
      shared({ 'next/link': { requiredVersion: false, fallback: false } })
    )
    const p = runtime.load(d, './NavLink')
    expect(await codeOf(p)).toBe('NF-036')
    await expect(p).rejects.toThrow(/"next\/link".*does not provide/)
    expect(instance.loads).toEqual([])
    expect(sleeps).toEqual([]) // never retried: it cannot succeed
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'component:error', code: 'NF-036' })
    )
  })

  test("the host's version must satisfy requiredVersion (no fallback)", async () => {
    const { runtime, instance } = setup()
    runtime.registerShared({ lib: { version: '1.4.0', module: {} } })
    const d = descriptor(
      'c1',
      shared({ lib: { requiredVersion: '^2.0.0', fallback: false } })
    )
    const p = runtime.load(d, './Counter')
    expect(await codeOf(p)).toBe('NF-036')
    await expect(p).rejects.toThrow(/"lib" \^2\.0\.0.*1\.4\.0/)
    expect(instance.loads).toEqual([])
  })

  test('a satisfying host version, or requiredVersion false, loads', async () => {
    const { runtime } = setup()
    runtime.registerShared({ lib: { version: '2.3.0', module: {} } })
    runtime.registerShared({ other: { version: '0.1.0', module: {} } })
    const d = descriptor(
      'c1',
      shared({
        lib: { requiredVersion: '^2.0.0', fallback: false },
        other: { requiredVersion: false, fallback: false },
      })
    )
    expect(await settle(runtime.load(d, './Counter'))).toBe('ok')
  })

  test('fallback: a missing or unsatisfying host copy is left to the build (its own copy)', async () => {
    const { runtime } = setup()
    runtime.registerShared({ lib: { version: '1.0.0', module: {} } })
    const d = descriptor(
      'c1',
      shared({
        lib: { requiredVersion: '^2.0.0', fallback: true },
        absent: { requiredVersion: '^1.0.0', fallback: true },
      })
    )
    expect(await settle(runtime.load(d, './Counter'))).toBe('ok')
  })

  test('only the exposes that import a module need it', async () => {
    const { runtime } = setup({ isServer: false })
    const d = descriptor(
      'c1',
      shared({
        'next/router': {
          requiredVersion: false,
          fallback: false,
          exposes: ['./PagesNavLink'],
        },
      })
    )
    expect(await settle(runtime.load(d, './Counter'))).toBe('ok')
    expect(await codeOf(runtime.load(d, './PagesNavLink'))).toBe('NF-036')
  })

  test('a host module version must be a semver version (NF-002)', () => {
    const { runtime } = setup()
    let code: string | undefined
    try {
      runtime.registerShared({ lib: { version: 'latest', module: {} } })
    } catch (e) {
      code = (e as { code?: string }).code
    }
    expect(code).toBe('NF-002')
  })

  test('the server renders a refused build in the browser only (null), no MF load', async () => {
    const { runtime, instance } = setup()
    const d = descriptor(
      'c1',
      shared({ lib: { requiredVersion: false, fallback: false } })
    )
    expect(await runtime.serverLoad(d, './Counter')).toBeNull()
    expect(instance.loads).toEqual([])
  })
})

describe('shared modules registered late, and fallback copies', () => {
  afterEach(() => {
    delete (globalThis as { __mf_module_cache__?: unknown }).__mf_module_cache__
  })

  test('a module registered after a container loaded reaches the next load (a new MF instance)', async () => {
    let created = 0
    const { runtime, instance } = setup({
      createInstance: (options) => {
        created++
        instance.shared.push(options.shared)
        return instance
      },
    })
    await runtime.load(descriptor('c1'), './NavLink')
    expect(created).toBe(1)
    // Registering creates nothing by itself.
    runtime.registerShared({ ctx: { version: '1.0.0', module: {} } })
    expect(created).toBe(1)
    await runtime.load(descriptor('c1'), './Counter')
    // An initialised container never sees modules registered after its
    // init: the new module made the runtime start over, and re-register.
    expect(created).toBe(2)
    expect(Object.keys(instance.shared.at(-1)!)).toContain('ctx')
    expect(instance.registrations.at(-1)).toEqual({
      entry: descriptor('c1').manifest,
      force: true,
    })
    // A module it already provides (another version): no new instance.
    runtime.registerShared({ ctx: { version: '1.1.0', module: {} } })
    await runtime.load(descriptor('c1'), './Other')
    expect(created).toBe(2)
  })

  test('browser: a late module drops the replaced MF instance from the global registry', async () => {
    type Registry = {
      __INSTANCES__: unknown[]
      __SHARE__: Record<string, unknown>
    }
    const g = globalThis as { __FEDERATION__?: Registry }
    const saved = g.__FEDERATION__
    const fed: Registry = { __INSTANCES__: [], __SHARE__: {} }
    g.__FEDERATION__ = fed
    try {
      const created: Fake[] = []
      const runtime = createComponentRuntime({
        isServer: false,
        react: fakeReact,
        hostShared: { react: { version: '19.3.1', module: fakeReact } },
        // As MF's createInstance: every instance joins __INSTANCES__, and
        // the first of a name registers its share scopes under that name.
        createInstance: (options) => {
          const next = Object.assign(fakeInstance(), { shareScopeMap: {} })
          fed.__INSTANCES__.push(next)
          fed.__SHARE__[options.name] ??= next.shareScopeMap
          created.push(next)
          return next
        },
        canLoadServerCode: () => false,
      })
      await runtime.load(descriptor('c1'), './NavLink')
      runtime.registerShared({ ctx: { version: '1.0.0', module: {} } })
      await runtime.load(descriptor('c1'), './Counter')
      expect(created).toHaveLength(2)
      expect(fed.__INSTANCES__).toEqual([created[1]])
      expect(fed.__SHARE__.nf_host).toBe(
        (created[1] as unknown as { shareScopeMap: unknown }).shareScopeMap
      )
    } finally {
      g.__FEDERATION__ = saved
    }
  })

  test("fallback: a satisfying host copy is what the build's own copy resolves to", async () => {
    const hostCopy = { copy: 'host' }
    const { runtime, scope } = setup()
    runtime.registerShared({ lib: { version: '2.1.0', module: hostCopy } })
    const d = descriptor('c1', {
      shared: {
        lib: {
          requiredVersion: '^2.0.0',
          fallback: true,
          version: '2.0.0',
        },
      },
    })
    await runtime.load(d, './Counter')
    const share = (
      scope().globals as {
        __mf_module_cache__?: { share: Record<string, unknown> }
      }
    ).__mf_module_cache__?.share
    expect(share?.['default:lib@2.0.0']).toBe(hostCopy)
    // Server: in the runtime's own cache, never the process-wide one.
    expect(
      (globalThis as { __mf_module_cache__?: unknown }).__mf_module_cache__
    ).toBeUndefined()
  })

  test("fallback: never for React or next/* (always the host's), even in a descriptor that says so", async () => {
    const { runtime, scope } = setup()
    // Every React, React DOM and Next.js module, subpaths included.
    const names = [
      'next/link',
      'next/head',
      'next',
      'react',
      'react-dom/server',
      'react/jsx-dev-runtime',
    ]
    runtime.registerShared(
      Object.fromEntries(
        names.map((name) => [name, { version: '19.3.1', module: {} }])
      )
    )
    const d = descriptor('c1', {
      shared: Object.fromEntries(
        names.map((name) => [
          name,
          { requiredVersion: false, fallback: true, version: '19.3.1' },
        ])
      ),
    })
    await runtime.load(d, './Counter')
    const share =
      (
        scope().globals as {
          __mf_module_cache__?: { share: Record<string, unknown> }
        }
      ).__mf_module_cache__?.share ?? {}
    for (const name of names) {
      expect(share[`default:${name}@19.3.1`]).toBeUndefined()
    }
  })

  const fallbackDescriptor = () =>
    descriptor('c1', {
      shared: {
        lib: { requiredVersion: '^2.0.0', fallback: true, version: '2.0.0' },
      },
    })
  const cachedLib = (holder: object = globalThis) =>
    (
      holder as {
        __mf_module_cache__?: { share: Record<string, unknown> }
      }
    ).__mf_module_cache__?.share?.['default:lib@2.0.0']

  test('server: a process with two Reacts (two router layers) seeds each layer its own copy', async () => {
    const otherReact = { useState: () => 'other', version: '19.3.1' }
    // The other layer's runtime (an App Router and a Pages Router route).
    const other = setup({
      react: otherReact,
      hostShared: { react: { version: '19.3.1', module: otherReact } },
    })
    const otherCopy = { layer: 'other' }
    other.runtime.registerShared({
      lib: { version: '2.1.0', module: otherCopy },
    })
    await other.runtime.load(fallbackDescriptor(), './Counter')
    const ownCopy = { layer: 'own' }
    const { runtime, scope } = setup()
    runtime.registerShared({ lib: { version: '2.1.0', module: ownCopy } })
    await runtime.load(fallbackDescriptor(), './Counter')
    expect(cachedLib(other.scope().globals)).toBe(otherCopy)
    expect(cachedLib(scope().globals)).toBe(ownCopy)
    expect(cachedLib()).toBeUndefined()
  })

  test("server: another layer's React does not stop a build that needs a seeded copy from server-rendering", async () => {
    const otherReact = { useState: () => 'other', version: '19.3.1' }
    setup({
      react: otherReact,
      hostShared: { react: { version: '19.3.1', module: otherReact } },
    })
    const hostCopy = { copy: 'host' }
    const { runtime, instance, scope } = setup()
    runtime.registerShared({ lib: { version: '2.1.0', module: hostCopy } })
    // Each layer seeds its own scope, so the server renders the host's copy,
    // the same one the browser seeds: no hydration mismatch.
    expect(
      await runtime.serverLoad(fallbackDescriptor(), './Counter')
    ).not.toBeNull()
    expect(instance.loads).toHaveLength(1)
    expect(cachedLib(scope().globals)).toBe(hostCopy)
    // An unsatisfying host copy means the bundled copy on both sides: SSR.
    const unsatisfied = setup()
    unsatisfied.runtime.registerShared({
      lib: { version: '1.0.0', module: {} },
    })
    expect(
      await unsatisfied.runtime.serverLoad(fallbackDescriptor(), './Counter')
    ).not.toBeNull()
    expect(cachedLib(unsatisfied.scope().globals)).toBeUndefined()
  })

  /** A server runtime providing lib 2.1.0 and ctx, with its scope created. */
  async function withLib(lib: object = {}) {
    const ctx = setup()
    ctx.runtime.registerShared({
      lib: { version: '2.1.0', module: lib },
      ctx: { version: '1.0.0', module: {} },
    })
    await ctx.runtime.load(descriptor('c0'), './Counter')
    return ctx
  }

  test('server: a stale share cache (another instance of a host module) never seeds a fallback copy', async () => {
    const { runtime, scope } = await withLib()
    scope().globals.__mf_module_cache__ = {
      share: { 'default:ctx': { other: true } },
    }
    await runtime.load(fallbackDescriptor(), './Counter')
    expect(cachedLib(scope().globals)).toBeUndefined()
  })

  test('server: a build needing a copy a stale own cache cannot seed renders browser-only (no hydration mismatch)', async () => {
    rs.spyOn(console, 'warn').mockImplementation(() => {})
    const { runtime, instance, scope } = await withLib()
    const loadsBefore = instance.loads.length
    scope().globals.__mf_module_cache__ = {
      share: { 'default:ctx': { other: true } },
    }
    // The browser seeds the host's copy, so the server must not render the
    // bundled one: it leaves the component to the browser, loading nothing.
    expect(
      await runtime.serverLoad(fallbackDescriptor(), './Counter')
    ).toBeNull()
    expect(instance.loads).toHaveLength(loadsBefore)
    expect(cachedLib(scope().globals)).toBeUndefined()
  })

  test('server: a module registered late starts a new scope, so a bundled copy cached earlier never shadows the host copy', async () => {
    const { runtime, scopes } = setup()
    runtime.registerShared({ ctx: { version: '1.0.0', module: {} } })
    await runtime.load(descriptor('c0'), './Counter')
    // The build's own copy evaluated first (the host had no lib yet).
    const bundled = { copy: 'bundled' }
    scopes[0]!.globals.__mf_module_cache__ = {
      share: { 'default:lib@2.0.0': bundled },
    }
    const hostCopy = { copy: 'host' }
    runtime.registerShared({ lib: { version: '2.1.0', module: hostCopy } })
    expect(
      await runtime.serverLoad(fallbackDescriptor(), './Counter')
    ).not.toBeNull()
    // A new scope, seeded with the host copy the browser seeds too.
    expect(scopes).toHaveLength(2)
    expect(scopes[1]!.id).not.toBe(scopes[0]!.id)
    expect(scopes[1]!.layer).toBe(scopes[0]!.layer)
    expect(cachedLib(scopes[1]!.globals)).toBe(hostCopy)
    expect(cachedLib(scopes[0]!.globals)).toBe(bundled)
  })

  test('server: a cached copy of a fallback module that is not the host copy blocks SSR', async () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    const first = { copy: 'first' }
    const { runtime, scope } = await withLib(first)
    await runtime.load(fallbackDescriptor(), './Counter')
    expect(cachedLib(scope().globals)).toBe(first)
    expect(runtime.serverBlock(fallbackDescriptor())).toBeNull()
    // Registered again with another object (not a new name: no restart).
    runtime.registerShared({ lib: { version: '2.1.0', module: { copy: 2 } } })
    expect(runtime.serverBlock(fallbackDescriptor())).toBe('stale')
    // A build whose range the host copy does not satisfy keeps its own copy:
    // not stale.
    const narrow = descriptor('c2', {
      shared: {
        lib: { requiredVersion: '^3.0.0', fallback: true, version: '2.0.0' },
      },
    })
    expect(runtime.serverBlock(narrow)).toBeNull()
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(
      /NF-028.*"lib"/
    )
  })

  test('server: each stale fallback copy gets a new scope, at most MAX_SCOPES, then browser-only (warned once)', async () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    const forgotten: Array<[unknown, Scope | undefined]> = []
    const hostCopy = { copy: 'host' }
    const { runtime, scope, scopes, tick } = setup({
      forget: (instance, s) => forgotten.push([instance, s as Scope]),
    })
    runtime.registerShared({ lib: { version: '2.1.0', module: hostCopy } })
    await runtime.load(descriptor('c0'), './Counter')
    const stale = () => {
      scope().globals.__mf_module_cache__ = {
        share: { 'default:lib@2.0.0': { copy: 'bundled' } },
      }
    }
    for (let n = 1; n < MAX_SCOPES; n++) {
      stale()
      tick(5_000)
      expect(
        await runtime.serverLoad(fallbackDescriptor(), './Counter')
      ).not.toBeNull()
      expect(scopes).toHaveLength(n + 1)
      expect(cachedLib(scope().globals)).toBe(hostCopy)
    }
    // Each replaced scope was dropped with its instance.
    expect(forgotten.map(([, s]) => s?.id)).toEqual(
      scopes.slice(0, -1).map((s) => s.id)
    )
    stale()
    tick(5_000)
    expect(
      await runtime.serverLoad(fallbackDescriptor(), './Counter')
    ).toBeNull()
    tick(5_000)
    expect(
      await runtime.serverLoad(fallbackDescriptor(), './Counter')
    ).toBeNull()
    expect(scopes).toHaveLength(MAX_SCOPES)
    expect(runtime.serverBlock(fallbackDescriptor())).toBe('scopes')
    expect(
      warn.mock.calls
        .map((c) => c.join(' '))
        .filter((l) => /NF-028.*stale fallback copy again/.test(l))
    ).toHaveLength(1)
  })

  test('server: the post-load check reads the scope the module was loaded in', async () => {
    rs.spyOn(console, 'warn').mockImplementation(() => {})
    const { runtime, instance, scope, scopes, tick } = setup()
    runtime.registerShared({ lib: { version: '2.1.0', module: {} } })
    await runtime.load(descriptor('c0'), './Counter')
    let release!: () => void
    const original = instance.loadRemote.bind(instance)
    instance.loadRemote = async (id) => {
      await new Promise<void>((r) => (release = r))
      return original(id)
    }
    // Loading in the first scope...
    const pending = runtime.serverLoad(descriptor('c1'), './Counter')
    await new Promise((r) => setTimeout(r, 0))
    const first = scopes[0]!
    instance.loadRemote = original
    // ...while a stale fallback copy moves the runtime to a new scope.
    scope().globals.__mf_module_cache__ = {
      share: { 'default:lib@2.0.0': { copy: 'bundled' } },
    }
    tick(5_000)
    const renewed = runtime.serverLoad(fallbackDescriptor(), './Counter')
    // Another React reaches the first scope's cache meanwhile.
    first.globals.__mf_module_cache__ = {
      share: { react: { useState: () => 'other' } },
    }
    release()
    expect(await pending).toBeNull()
    expect(await renewed).not.toBeNull()
    expect(scopes).toHaveLength(2)
  })

  test('browser: one React per page, so a satisfying host copy is seeded', async () => {
    const otherReact = { useState: () => 'other', version: '19.3.1' }
    setup({ isServer: false, react: otherReact })
    const hostCopy = {}
    const { runtime } = setup({ isServer: false })
    runtime.registerShared({ lib: { version: '2.1.0', module: hostCopy } })
    await runtime.load(fallbackDescriptor(), './Counter')
    expect(cachedLib()).toBe(hostCopy)
  })

  test('fallback: an unsatisfying host copy, another expose, or a copy already in use is left alone', async () => {
    const bundled = { copy: 'bundled' }
    const { runtime, scope } = setup()
    runtime.registerShared({
      lib: { version: '1.4.0', module: {} },
      other: { version: '2.0.0', module: {} },
      used: { version: '1.0.0', module: {} },
    })
    await runtime.load(descriptor('c0'), './Counter')
    scope().globals.__mf_module_cache__ = {
      share: { 'default:used@1.0.0': bundled },
    }
    const fallback = (version: string, exposes?: string[]) => ({
      requiredVersion: '^1.0.0',
      fallback: true,
      version,
      ...(exposes ? { exposes } : {}),
    })
    const d = descriptor('c1', {
      shared: {
        lib: { ...fallback('2.0.0'), requiredVersion: '^2.0.0' },
        other: {
          ...fallback('2.0.0', ['./Elsewhere']),
          requiredVersion: '^2.0.0',
        },
        used: fallback('1.0.0'),
      },
    })
    await runtime.load(d, './Counter')
    const share = (
      scope().globals as unknown as {
        __mf_module_cache__: { share: Record<string, unknown> }
      }
    ).__mf_module_cache__.share
    expect(share['default:lib@2.0.0']).toBeUndefined()
    expect(share['default:other@2.0.0']).toBeUndefined()
    expect(share['default:used@1.0.0']).toBe(bundled)
  })
})

describe('next/* modules', () => {
  test("the identity guard names the module: another router's next/* in the process-wide cache is never read", async () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    const { runtime, scope } = await loaded()
    runtime.registerShared({ 'next/link': { version: '16.4.6', module: {} } })
    await runtime.load(descriptor('c1'), './Counter')
    ;(globalThis as { __mf_module_cache__?: unknown }).__mf_module_cache__ = {
      share: { 'default:next/link': { other: true }, react: fakeReact },
    }
    expect(runtime.serverBlock(descriptor('c1'))).toBeNull()
    scope().globals.__mf_module_cache__ = {
      share: { 'default:next/link': { other: true }, react: fakeReact },
    }
    expect(runtime.serverBlock(descriptor('c1'))).toBe('stale')
    const line = warn.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(line).toMatch(/NF-028.*"next\/link"/)
  })

  test('a canary or prerelease Next host satisfies a next/* range on its release numbers', async () => {
    const { runtime } = setup()
    runtime.registerShared({
      'next/link': { version: '16.5.0-canary.3', module: {} },
      lib: { version: '2.0.0-beta.1', module: {} },
    })
    const d = descriptor('c1', {
      shared: {
        'next/link': { requiredVersion: '^16.0.0', fallback: false },
      },
    })
    expect(await settle(runtime.load(d, './NavLink'))).toBe('ok')
    // Only next/*: other modules keep npm's prerelease rule.
    const strict = descriptor('c2', {
      shared: { lib: { requiredVersion: '^2.0.0', fallback: false } },
    })
    expect(await settle(runtime.load(strict, './Counter'))).toBe('failed')
  })
})
