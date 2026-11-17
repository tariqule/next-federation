import { readFileSync } from 'node:fs'
import { Activity, StrictMode, act, version } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import type {
  IslandBootstrapModule,
  IslandEnvelope,
  IslandHandle,
  MountIslandOptions,
} from '@next-federation/protocol'
import { islandSharedEntry, islandShareScope } from '@next-federation/protocol'
import { NFError, logger } from '@next-federation/sdk'
import {
  ISLAND_EVENT,
  IslandMount,
  clearIslandTokens,
  getLiveIslandCount,
  type IslandClientEvent,
  type IslandMountProps,
} from '../src/index.ts'
import { destroyEntry, getEntry } from '../src/island-registry.ts'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const PLACEHOLDER = 'nfid-1a2b3c4d'
const BOOT_1 = 'https://shop.example.com/_nf/b1/bootstrap.js'
const BOOT_2 = 'https://shop.example.com/_nf/b2/bootstrap.js'

function envelope(over: Partial<IslandEnvelope> = {}): IslandEnvelope {
  return {
    protocolVersion: 1,
    remote: 'shop',
    buildId: 'b1',
    mode: 'development',
    html: `<p id="${PLACEHOLDER}:r0:">cart v1</p>`,
    rscPayload: `0:["${PLACEHOLDER}:r0:","v1"]`,
    css: [],
    bootstrap: BOOT_1,
    reactVersion: '19.3.1',
    idPlaceholder: PLACEHOLDER,
    ...over,
  }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type MountCall = { el: HTMLElement; options: MountIslandOptions }

/** A fake bootstrap module recording every call, with a controllable import. */
function fakeBootstrap() {
  const mounts: MountCall[] = []
  const updates: { el: HTMLElement; rscPayload: string }[] = []
  const destroys: HTMLElement[] = []
  // The container's HTML at each destroy.
  const destroyedHtml: string[] = []
  let throwOnMount: unknown = null
  let duringMount: ((el: HTMLElement) => void) | null = null
  // With manual hydration, each handle carries a `hydrated` promise the test
  // resolves; otherwise handles have none (an older bootstrap).
  let manualHydration = false
  const hydrations: Deferred<void>[] = []
  const module: IslandBootstrapModule = {
    mountIsland(el, options) {
      if (throwOnMount) throw throwOnMount
      mounts.push({ el, options })
      duringMount?.(el)
      const handle: IslandHandle = {
        update(next) {
          updates.push({ el, rscPayload: next.rscPayload })
        },
        destroy() {
          destroys.push(el)
          destroyedHtml.push(el.innerHTML)
        },
      }
      if (manualHydration) {
        const d = deferred<void>()
        hydrations.push(d)
        handle.hydrated = d.promise
      }
      return handle
    },
  }
  const loads: { url: string; d: Deferred<IslandBootstrapModule> }[] = []
  const loadBootstrap = rs.fn((url: string) => {
    const d = deferred<IslandBootstrapModule>()
    loads.push({ url, d })
    return d.promise
  })
  return {
    mounts,
    updates,
    destroys,
    destroyedHtml,
    loads,
    loadBootstrap,
    setThrowOnMount(error: unknown) {
      throwOnMount = error
    },
    hydrations,
    useManualHydration() {
      manualHydration = true
    },
    async hydrate(index = hydrations.length - 1) {
      await act(async () => {
        hydrations[index]!.resolve()
        await Promise.resolve()
      })
    },
    /** Runs inside `mountIsland`, before the handle is returned. */
    setDuringMount(fn: (el: HTMLElement) => void) {
      duringMount = fn
    },
    /** Resolves every pending import with the fake module. */
    async resolveAll() {
      await act(async () => {
        for (const l of loads) l.d.resolve(module)
        await Promise.resolve()
      })
    },
  }
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  rs.spyOn(logger, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  await tick()
  expect(getLiveIslandCount()).toBe(0)
  rs.restoreAllMocks()
})

function render(node: ReactNode): void {
  act(() => root.render(node))
}

/** Lets the deferred teardown (`setTimeout(0)`) run. */
async function tick(): Promise<void> {
  await act(() => new Promise<void>((r) => setTimeout(r, 5)))
}

function islandEl(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-nf-root]')
  if (!el) throw new Error('no island container rendered')
  return el
}

function mount(props: Partial<IslandMountProps> & { boot: FakeBoot }) {
  const { boot, ...rest } = props
  return (
    <IslandMount
      envelope={envelope()}
      loadBootstrap={boot.loadBootstrap}
      {...rest}
    />
  )
}
type FakeBoot = ReturnType<typeof fakeBootstrap>

describe('IslandMount', () => {
  test('server render contains the prefixed html and booting state', () => {
    const html = renderToString(<IslandMount envelope={envelope()} />)
    expect(html).toContain('data-nf-root=""')
    expect(html).toContain('data-nf-remote="shop"')
    expect(html).toContain('data-nf-build="b1"')
    expect(html).toContain('data-nf-state="booting"')
    expect(html).toContain('cart v1')
    // The placeholder is followed by the per-mount id, never by the remote's own id.
    expect(html).not.toContain(`${PLACEHOLDER}:r0:`)
    expect(html).toMatch(new RegExp(`id="${PLACEHOLDER}[A-Za-z0-9]+-:r0:"`))
  })

  test('hydrates once with the original envelope, even under StrictMode', async () => {
    const boot = fakeBootstrap()
    render(<StrictMode>{mount({ boot })}</StrictMode>)
    await boot.resolveAll()
    expect(boot.mounts).toHaveLength(1)
    const { el, options } = boot.mounts[0]!
    expect(el).toBe(islandEl())
    expect(options.envelope).toMatchObject({
      remote: 'shop',
      buildId: 'b1',
      mode: 'development',
    })
    expect(options.rscPayload).toBe(
      `0:["${options.identifierPrefix}:r0:","v1"]`
    )
    expect(options.identifierPrefix.startsWith(PLACEHOLDER)).toBe(true)
    expect(el.innerHTML).toContain(`${options.identifierPrefix}:r0:`)
    expect(el.dataset.nfState).toBe('live')
    expect(getLiveIslandCount()).toBe(1)
    expect(boot.updates).toHaveLength(0)
  })

  test('a new envelope from the same build calls update and does not touch the DOM', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    await boot.resolveAll()
    const el = islandEl()
    const before = el.innerHTML
    const prefix = boot.mounts[0]!.options.identifierPrefix
    render(
      mount({
        boot,
        envelope: envelope({
          html: '<p>cart v2</p>',
          rscPayload: `0:["${PLACEHOLDER}:r0:","v2"]`,
        }),
      })
    )
    expect(boot.updates).toEqual([
      { el, rscPayload: `0:["${prefix}:r0:","v2"]` },
    ])
    expect(el.innerHTML).toBe(before)
    expect(boot.loadBootstrap).toHaveBeenCalledTimes(1)
    expect(boot.mounts).toHaveLength(1)
    expect(boot.destroys).toHaveLength(0)
  })

  test('an envelope that arrives while the bootstrap loads is applied right after hydrate', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    render(
      mount({
        boot,
        envelope: envelope({ rscPayload: `0:["${PLACEHOLDER}:r0:","v2"]` }),
      })
    )
    expect(boot.updates).toHaveLength(0)
    await boot.resolveAll()
    expect(boot.mounts).toHaveLength(1)
    const prefix = boot.mounts[0]!.options.identifierPrefix
    // Hydration uses the payload matching the frozen HTML...
    expect(boot.mounts[0]!.options.rscPayload).toBe(`0:["${prefix}:r0:","v1"]`)
    // ...then the newest one is applied.
    expect(boot.updates.map((u) => u.rscPayload)).toEqual([
      `0:["${prefix}:r0:","v2"]`,
    ])
  })

  test('a new buildId destroys, rewrites html and bootstraps again', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    await boot.resolveAll()
    const el = islandEl()
    const prefix = boot.mounts[0]!.options.identifierPrefix
    render(
      mount({
        boot,
        envelope: envelope({
          buildId: 'b2',
          bootstrap: BOOT_2,
          html: `<p id="${PLACEHOLDER}:r0:">cart b2</p>`,
          rscPayload: `0:["${PLACEHOLDER}:r0:","b2"]`,
        }),
      })
    )
    expect(boot.destroys).toEqual([el])
    expect(islandEl()).toBe(el)
    expect(el.innerHTML).toBe(`<p id="${prefix}:r0:">cart b2</p>`)
    expect(el.dataset.nfState).toBe('booting')
    expect(el.dataset.nfBuild).toBe('b2')
    expect(boot.loadBootstrap).toHaveBeenLastCalledWith(BOOT_2)
    expect(getLiveIslandCount()).toBe(0)
    await boot.resolveAll()
    expect(boot.mounts).toHaveLength(2)
    expect(boot.mounts[1]!.options.envelope.buildId).toBe('b2')
    expect(boot.mounts[1]!.options.rscPayload).toBe(`0:["${prefix}:r0:","b2"]`)
    expect(el.dataset.nfState).toBe('live')
    expect(getLiveIslandCount()).toBe(1)
  })

  test("with the host's React provided, the old root is destroyed after the host effect and before its HTML is replaced", async () => {
    // provideHostReact() registered this React: island roots may run on it.
    const entry = islandSharedEntry(version, 'host', () =>
      Promise.resolve(() => null)
    )
    islandShareScope()['react-dom'] = { [version]: entry }
    try {
      const boot = fakeBootstrap()
      render(mount({ boot }))
      await boot.resolveAll()
      const el = islandEl()
      const prefix = boot.mounts[0]!.options.identifierPrefix
      const b2 = envelope({
        buildId: 'b2',
        bootstrap: BOOT_2,
        html: `<p id="${PLACEHOLDER}:r0:">cart b2</p>`,
        rscPayload: `0:["${PLACEHOLDER}:r0:","b2"]`,
      })
      render(mount({ boot, envelope: b2 }))
      // Not inside the effect.
      expect(boot.destroys).toEqual([])
      expect(el.dataset.nfBuild).toBe('b2')
      await act(async () => {})
      expect(boot.destroys).toEqual([el])
      // Unmounted while its own HTML was still in the container.
      expect(boot.destroyedHtml).toEqual([`<p id="${prefix}:r0:">cart v1</p>`])
      expect(el.innerHTML).toBe(`<p id="${prefix}:r0:">cart b2</p>`)
      expect(boot.loadBootstrap).toHaveBeenLastCalledWith(BOOT_2)
      await boot.resolveAll()
      expect(boot.mounts).toHaveLength(2)
      expect(boot.mounts[1]!.options.envelope.buildId).toBe('b2')
      expect(el.dataset.nfState).toBe('live')
      expect(getLiveIslandCount()).toBe(1)
    } finally {
      delete (globalThis as { __FEDERATION__?: unknown }).__FEDERATION__
    }
  })

  test("with the host's React provided, a redeploy under StrictMode destroys once, after the effect, and re-bootstraps once", async () => {
    const entry = islandSharedEntry(version, 'host', () =>
      Promise.resolve(() => null)
    )
    islandShareScope()['react-dom'] = { [version]: entry }
    try {
      const boot = fakeBootstrap()
      render(<StrictMode>{mount({ boot })}</StrictMode>)
      await boot.resolveAll()
      const el = islandEl()
      const prefix = boot.mounts[0]!.options.identifierPrefix
      const b2 = envelope({
        buildId: 'b2',
        bootstrap: BOOT_2,
        html: `<p id="${PLACEHOLDER}:r0:">cart b2</p>`,
        rscPayload: `0:["${PLACEHOLDER}:r0:","b2"]`,
      })
      // StrictMode runs the effect twice: both runs see the old root.
      render(<StrictMode>{mount({ boot, envelope: b2 })}</StrictMode>)
      expect(boot.destroys).toEqual([])
      await act(async () => {})
      expect(boot.destroys).toEqual([el])
      expect(boot.destroyedHtml).toEqual([`<p id="${prefix}:r0:">cart v1</p>`])
      expect(el.innerHTML).toBe(`<p id="${prefix}:r0:">cart b2</p>`)
      expect(boot.loadBootstrap).toHaveBeenCalledTimes(2)
      expect(boot.loadBootstrap).toHaveBeenLastCalledWith(BOOT_2)
      await boot.resolveAll()
      expect(boot.mounts).toHaveLength(2)
      expect(el.dataset.nfState).toBe('live')
      expect(getLiveIslandCount()).toBe(1)
    } finally {
      delete (globalThis as { __FEDERATION__?: unknown }).__FEDERATION__
    }
  })

  test("with the host's React provided, two quick redeploys end on the newest build", async () => {
    const entry = islandSharedEntry(version, 'host', () =>
      Promise.resolve(() => null)
    )
    islandShareScope()['react-dom'] = { [version]: entry }
    try {
      const boot = fakeBootstrap()
      render(mount({ boot }))
      await boot.resolveAll()
      render(
        mount({
          boot,
          envelope: envelope({ buildId: 'b2', bootstrap: BOOT_2 }),
        })
      )
      const BOOT_3 = 'https://shop.example.com/_nf/b3/bootstrap.js'
      render(
        mount({
          boot,
          envelope: envelope({ buildId: 'b3', bootstrap: BOOT_3 }),
        })
      )
      await act(async () => {})
      expect(boot.destroys).toHaveLength(1)
      expect(boot.loadBootstrap).toHaveBeenCalledTimes(2)
      expect(boot.loadBootstrap).toHaveBeenLastCalledWith(BOOT_3)
      await boot.resolveAll()
      expect(boot.mounts.at(-1)!.options.envelope.buildId).toBe('b3')
      expect(getLiveIslandCount()).toBe(1)
    } finally {
      delete (globalThis as { __FEDERATION__?: unknown }).__FEDERATION__
    }
  })

  test('a new bootstrap URL with the same buildId also re-bootstraps', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    await boot.resolveAll()
    render(mount({ boot, envelope: envelope({ bootstrap: BOOT_2 }) }))
    expect(boot.destroys).toHaveLength(1)
    expect(boot.loadBootstrap).toHaveBeenCalledTimes(2)
    expect(boot.loadBootstrap).toHaveBeenLastCalledWith(BOOT_2)
    await boot.resolveAll()
    expect(boot.mounts).toHaveLength(2)
    expect(boot.updates).toHaveLength(0)
  })

  test('unmounting destroys the root on the next tick; live count returns to 0', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    await boot.resolveAll()
    const el = islandEl()
    expect(getLiveIslandCount()).toBe(1)
    render(null)
    // Not synchronously: cleanup only schedules the check.
    expect(boot.destroys).toHaveLength(0)
    await tick()
    expect(boot.destroys).toEqual([el])
    expect(getLiveIslandCount()).toBe(0)
  })

  test('effect cleanup with the node still connected keeps the root', async () => {
    const boot = fakeBootstrap()
    // A same-build envelope re-runs the effect (cleanup + setup) on the same node.
    render(mount({ boot }))
    await boot.resolveAll()
    render(mount({ boot, envelope: envelope() }))
    await tick()
    expect(boot.destroys).toHaveLength(0)
    // A hidden <Activity> runs effect cleanups but keeps the node connected.
    const tree = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>{mount({ boot, envelope: envelope() })}</Activity>
    )
    render(tree('visible'))
    await boot.resolveAll()
    const el = islandEl()
    const mountsBefore = boot.mounts.length
    render(tree('hidden'))
    await tick()
    expect(el.isConnected).toBe(true)
    expect(boot.destroys.filter((d) => d === el)).toHaveLength(0)
    render(tree('visible'))
    await tick()
    expect(boot.mounts).toHaveLength(mountsBefore)
    expect(boot.destroys.filter((d) => d === el)).toHaveLength(0)
    expect(el.dataset.nfState).toBe('live')
  })

  test('a key change (container swap) destroys the old root and mounts the new node', async () => {
    const boot = fakeBootstrap()
    render(<IslandMount key="a" {...mountProps(boot)} />)
    await boot.resolveAll()
    const first = islandEl()
    render(<IslandMount key="b" {...mountProps(boot)} />)
    const second = islandEl()
    expect(second).not.toBe(first)
    await boot.resolveAll()
    await tick()
    expect(boot.destroys).toEqual([first])
    expect(boot.mounts.map((m) => m.el)).toEqual([first, second])
    expect(getLiveIslandCount()).toBe(1)
  })

  test('unmount while the bootstrap is loading never calls mountIsland', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    render(null)
    await tick()
    await boot.resolveAll()
    expect(boot.mounts).toHaveLength(0)
    expect(getLiveIslandCount()).toBe(0)
  })

  for (const when of ['before', 'after'] as const) {
    test(`a bootstrap import rejected after unmount (${when} the deferred teardown) reports nothing`, async () => {
      const boot = fakeBootstrap()
      const events: IslandClientEvent[] = []
      const dom: Event[] = []
      document.addEventListener(ISLAND_EVENT, (e) => dom.push(e))
      render(mount({ boot, onEvent: (e) => events.push(e) }))
      render(null)
      if (when === 'after') await tick()
      await act(async () => {
        boot.loads[0]!.d.reject(
          new TypeError('Failed to fetch dynamically imported module')
        )
        await Promise.resolve()
      })
      await tick()
      expect(events).toEqual([])
      expect(dom).toEqual([])
      expect(logger.error).not.toHaveBeenCalled()
      expect(boot.mounts).toHaveLength(0)
      expect(getLiveIslandCount()).toBe(0)
    })
  }

  test('10 toggles while the import is pending, then one rejection, report one error for the mounted island only', async () => {
    const boot = fakeBootstrap()
    const events: IslandClientEvent[] = []
    let shown = true
    const node = () =>
      shown ? mount({ boot, onEvent: (e) => events.push(e) }) : null
    render(node())
    for (let i = 0; i < 10; i++) {
      shown = !shown
      render(node())
    }
    await tick()
    await act(async () => {
      for (const l of boot.loads)
        l.d.reject(new TypeError('Failed to fetch dynamically imported module'))
      await Promise.resolve()
    })
    await tick()
    // Only the island still on the page reports its failure.
    expect(events.map((e) => e.type)).toEqual(['island:error'])
    expect(islandEl().dataset.nfState).toBe('inert')
    expect(getLiveIslandCount()).toBe(0)
  })

  test('10 rapid mount/unmount toggles leave exactly one live root', async () => {
    const boot = fakeBootstrap()
    let shown = true
    render(shown ? mount({ boot }) : null)
    for (let i = 0; i < 10; i++) {
      shown = !shown
      render(shown ? mount({ boot }) : null)
    }
    render(mount({ boot }))
    await boot.resolveAll()
    await tick()
    expect(getLiveIslandCount()).toBe(1)
    expect(boot.mounts).toHaveLength(1)
    expect(boot.mounts[0]!.el).toBe(islandEl())
  })

  test('two mounts of one envelope pass different identifierPrefix values', async () => {
    const boot = fakeBootstrap()
    const shared = envelope()
    render(
      <>
        {mount({ boot, envelope: shared })}
        {mount({ boot, envelope: shared })}
      </>
    )
    await boot.resolveAll()
    expect(boot.mounts).toHaveLength(2)
    const [a, b] = boot.mounts.map((m) => m.options.identifierPrefix)
    expect(a).not.toBe(b)
    const els = container.querySelectorAll('[data-nf-root]')
    expect(els[0]!.innerHTML).toContain(`${a}:r0:`)
    expect(els[1]!.innerHTML).toContain(`${b}:r0:`)
    expect(getLiveIslandCount()).toBe(2)
  })

  test('a rejected bootstrap import leaves the html, marks inert and emits NF-011', async () => {
    const boot = fakeBootstrap()
    const events: IslandClientEvent[] = []
    render(mount({ boot, onEvent: (e) => events.push(e) }))
    const el = islandEl()
    const html = el.innerHTML
    const failure = new TypeError('Failed to fetch dynamically imported module')
    await act(async () => {
      boot.loads[0]!.d.reject(failure)
      await Promise.resolve()
    })
    expect(el.innerHTML).toBe(html)
    expect(el.dataset.nfState).toBe('inert')
    expect(events).toEqual([
      {
        type: 'island:error',
        remote: 'shop',
        buildId: 'b1',
        kind: 'bootstrap',
        code: 'NF-011',
        error: failure,
      },
    ])
    expect(logger.error).toHaveBeenCalledWith(
      'NF-011',
      expect.any(String),
      failure
    )
    expect(getLiveIslandCount()).toBe(0)
  })

  test('mountIsland throwing NF-006 marks inert and reports NF-006', async () => {
    const boot = fakeBootstrap()
    const events: IslandClientEvent[] = []
    const failure = new NFError('NF-006', 'mode mismatch')
    boot.setThrowOnMount(failure)
    render(mount({ boot, onEvent: (e) => events.push(e) }))
    const el = islandEl()
    const html = el.innerHTML
    await boot.resolveAll()
    expect(el.dataset.nfState).toBe('inert')
    expect(el.innerHTML).toBe(html)
    expect(events).toMatchObject([
      { type: 'island:error', kind: 'bootstrap', code: 'NF-006' },
    ])
    expect(events[0]).toHaveProperty('error', failure)
    expect(logger.error).toHaveBeenCalledWith(
      'NF-006',
      expect.any(String),
      failure
    )
  })

  test('an uncaught island error renders errorFallback and emits NF-012', async () => {
    const boot = fakeBootstrap()
    const events: IslandClientEvent[] = []
    const seenOnContainer: unknown[] = []
    render(
      mount({
        boot,
        onEvent: (e) => events.push(e),
        errorFallback: <p>island unavailable</p>,
      })
    )
    await boot.resolveAll()
    const el = islandEl()
    el.addEventListener(ISLAND_EVENT, (e) =>
      seenOnContainer.push((e as CustomEvent).detail)
    )
    const { onError } = boot.mounts[0]!.options
    const failure = new Error('render crashed')
    await act(async () => {
      onError!(new Error('caught one'), 'caught')
      await Promise.resolve()
    })
    // caught / recoverable: event only.
    expect(boot.destroys).toHaveLength(0)
    expect(el.dataset.nfState).toBe('live')
    await act(async () => {
      onError!(failure, 'uncaught')
      await Promise.resolve()
    })
    expect(boot.destroys).toEqual([el])
    expect(el.dataset.nfState).toBe('failed')
    expect(container.querySelector('[data-nf-root]')).toBeNull()
    expect(container.textContent).toBe('island unavailable')
    const errors = events.filter((e) => e.type === 'island:error')
    expect(errors.map((e) => e.kind)).toEqual(['caught', 'uncaught'])
    expect(errors[1]).toEqual({
      type: 'island:error',
      remote: 'shop',
      buildId: 'b1',
      kind: 'uncaught',
      code: 'NF-012',
      error: failure,
    })
    expect(seenOnContainer).toEqual(errors)
    expect(logger.error).toHaveBeenCalledWith(
      'NF-012',
      expect.any(String),
      failure
    )
    expect(getLiveIslandCount()).toBe(0)
  })

  test('an island removed while hidden in <Activity> is torn down', async () => {
    const boot = fakeBootstrap()
    const tree = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>{mount({ boot })}</Activity>
    )
    render(tree('visible'))
    await boot.resolveAll()
    const el = islandEl()
    render(tree('hidden'))
    await tick()
    expect(boot.destroys).toHaveLength(0)
    // The hidden Activity already ran the effect cleanup while connected;
    // deleting it now runs no cleanup at all.
    render(null)
    await tick()
    expect(el.isConnected).toBe(false)
    expect(getLiveIslandCount()).toBe(0)
    expect(boot.destroys).toEqual([el])
  })

  test('a handle returned for an entry destroyed during mountIsland is destroyed', async () => {
    const boot = fakeBootstrap()
    boot.setDuringMount((el) => destroyEntry(getEntry(el)!))
    render(mount({ boot }))
    await boot.resolveAll()
    expect(boot.mounts).toHaveLength(1)
    expect(boot.destroys).toEqual([islandEl()])
    expect(getLiveIslandCount()).toBe(0)
  })

  test('a failed island stays failed for its build and recovers on a new buildId', async () => {
    const boot = fakeBootstrap()
    const fallback = <p>island unavailable</p>
    render(mount({ boot, errorFallback: fallback }))
    await boot.resolveAll()
    const first = islandEl()
    await act(async () => {
      boot.mounts[0]!.options.onError!(new Error('x'), 'uncaught')
      await Promise.resolve()
    })
    expect(container.textContent).toBe('island unavailable')
    const prefix = boot.mounts[0]!.options.identifierPrefix
    // Same build: still failed, nothing loaded.
    render(
      mount({
        boot,
        errorFallback: fallback,
        envelope: envelope({ rscPayload: `0:["${PLACEHOLDER}:r0:","v2"]` }),
      })
    )
    expect(container.textContent).toBe('island unavailable')
    expect(boot.loadBootstrap).toHaveBeenCalledTimes(1)
    // New build: a fresh container with the new HTML, bootstrapped again.
    render(
      mount({
        boot,
        errorFallback: fallback,
        envelope: envelope({
          buildId: 'b2',
          bootstrap: BOOT_2,
          html: `<p id="${PLACEHOLDER}:r0:">cart b2</p>`,
          rscPayload: `0:["${PLACEHOLDER}:r0:","b2"]`,
        }),
      })
    )
    const second = islandEl()
    expect(second).not.toBe(first)
    expect(second.innerHTML).toBe(`<p id="${prefix}:r0:">cart b2</p>`)
    expect(second.dataset.nfState).toBe('booting')
    expect(boot.loadBootstrap).toHaveBeenLastCalledWith(BOOT_2)
    await boot.resolveAll()
    expect(boot.mounts).toHaveLength(2)
    expect(boot.mounts[1]!.el).toBe(second)
    expect(boot.mounts[1]!.options.rscPayload).toBe(`0:["${prefix}:r0:","b2"]`)
    expect(second.dataset.nfState).toBe('live')
    expect(getLiveIslandCount()).toBe(1)
  })

  test('a buildId change while the first import is pending ignores the old load', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    render(
      mount({ boot, envelope: envelope({ buildId: 'b2', bootstrap: BOOT_2 }) })
    )
    expect(boot.loadBootstrap).toHaveBeenCalledTimes(2)
    await boot.resolveAll()
    await tick()
    expect(boot.mounts).toHaveLength(1)
    expect(boot.mounts[0]!.options.envelope.buildId).toBe('b2')
    expect(boot.destroys).toHaveLength(0)
    expect(getLiveIslandCount()).toBe(1)
  })

  test('a same-build envelope while booting, then unmount, leaks nothing', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    render(
      mount({
        boot,
        envelope: envelope({ rscPayload: `0:["${PLACEHOLDER}:r0:","v2"]` }),
      })
    )
    render(null)
    await tick()
    await boot.resolveAll()
    await tick()
    expect(boot.mounts).toHaveLength(0)
    expect(boot.updates).toHaveLength(0)
    expect(getLiveIslandCount()).toBe(0)
  })

  test('stays booting until the bootstrap signals hydration, then goes live', async () => {
    const boot = fakeBootstrap()
    boot.useManualHydration()
    const events: IslandClientEvent[] = []
    render(mount({ boot, onEvent: (e) => events.push(e) }))
    await boot.resolveAll()
    const el = islandEl()
    expect(boot.mounts).toHaveLength(1)
    expect(el.dataset.nfState).toBe('booting')
    expect(events).toEqual([])
    await boot.hydrate()
    expect(el.dataset.nfState).toBe('live')
    expect(events).toMatchObject([{ type: 'island:hydrate', remote: 'shop' }])
  })

  test('envelopes that arrive before hydration finishes are applied once, after it', async () => {
    const boot = fakeBootstrap()
    boot.useManualHydration()
    render(<StrictMode>{mount({ boot })}</StrictMode>)
    await boot.resolveAll()
    const v = (n: number) => `0:["${PLACEHOLDER}:r0:","v${n}"]`
    // Same build, while the root is still hydrating (StrictMode double fetch).
    render(
      <StrictMode>
        {mount({ boot, envelope: envelope({ rscPayload: v(2) }) })}
      </StrictMode>
    )
    render(
      <StrictMode>
        {mount({ boot, envelope: envelope({ rscPayload: v(3) }) })}
      </StrictMode>
    )
    expect(boot.updates).toHaveLength(0)
    await boot.hydrate()
    const prefix = boot.mounts[0]!.options.identifierPrefix
    expect(boot.mounts).toHaveLength(1)
    expect(boot.updates.map((u) => u.rscPayload)).toEqual([
      `0:["${prefix}:r0:","v3"]`,
    ])
    // After hydration, updates go straight through.
    render(
      <StrictMode>
        {mount({ boot, envelope: envelope({ rscPayload: v(4) }) })}
      </StrictMode>
    )
    expect(boot.updates).toHaveLength(2)
  })

  test('a root that is replaced before it hydrates never goes live', async () => {
    const boot = fakeBootstrap()
    boot.useManualHydration()
    render(mount({ boot }))
    await boot.resolveAll()
    render(mount({ boot, envelope: envelope({ buildId: 'b2' }) }))
    await boot.resolveAll()
    const el = islandEl()
    await boot.hydrate(0)
    expect(el.dataset.nfState).toBe('booting')
    await boot.hydrate(1)
    expect(el.dataset.nfState).toBe('live')
    expect(boot.mounts.map((m) => m.options.envelope.buildId)).toEqual([
      'b1',
      'b2',
    ])
  })

  test('an uncaught error without errorFallback renders nothing', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    await boot.resolveAll()
    await act(async () => {
      boot.mounts[0]!.options.onError!(new Error('x'), 'uncaught')
      await Promise.resolve()
    })
    expect(container.innerHTML).toBe('')
  })

  test('an uncaught error from a replaced root does not fail the new island', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    await boot.resolveAll()
    const staleOnError = boot.mounts[0]!.options.onError!
    render(mount({ boot, envelope: envelope({ buildId: 'b2' }) }))
    await boot.resolveAll()
    await act(async () => {
      staleOnError(new Error('late'), 'uncaught')
      await Promise.resolve()
    })
    expect(islandEl().dataset.nfState).toBe('live')
    expect(getLiveIslandCount()).toBe(1)
  })

  test('events are dispatched as a bubbling nf:island CustomEvent', async () => {
    const boot = fakeBootstrap()
    const onEvent = rs.fn()
    const bubbled: CustomEvent[] = []
    const listener = (e: Event) => bubbled.push(e as CustomEvent)
    document.addEventListener(ISLAND_EVENT, listener)
    try {
      render(mount({ boot, onEvent }))
      await boot.resolveAll()
    } finally {
      document.removeEventListener(ISLAND_EVENT, listener)
    }
    expect(ISLAND_EVENT).toBe('nf:island')
    expect(bubbled).toHaveLength(1)
    expect(bubbled[0]!.bubbles).toBe(true)
    expect(bubbled[0]!.target).toBe(islandEl())
    expect(bubbled[0]!.detail).toMatchObject({
      type: 'island:hydrate',
      remote: 'shop',
      buildId: 'b1',
    })
    expect(typeof bubbled[0]!.detail.ms).toBe('number')
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(bubbled[0]!.detail)
  })

  test('a throwing onEvent is logged at debug level and does not break the mount', async () => {
    const boot = fakeBootstrap()
    const debug = rs.spyOn(logger, 'debug').mockImplementation(() => {})
    render(
      mount({
        boot,
        onEvent: () => {
          throw new Error('observer broke')
        },
      })
    )
    await boot.resolveAll()
    expect(islandEl().dataset.nfState).toBe('live')
    expect(debug).toHaveBeenCalled()
  })

  test('bridge defaults are merged under a partial bridge', async () => {
    const boot = fakeBootstrap()
    const prefetch = rs.fn()
    render(mount({ boot, bridge: { prefetch } }))
    await boot.resolveAll()
    const { bridge } = boot.mounts[0]!.options
    expect(bridge.basePath).toBe('')
    expect(bridge.locale).toBe('')
    bridge.prefetch('/cart')
    expect(prefetch).toHaveBeenCalledWith('/cart')
    const assign = rs.fn()
    const original = Object.getOwnPropertyDescriptor(window, 'location')!
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
    try {
      bridge.navigate('/checkout')
    } finally {
      Object.defineProperty(window, 'location', original)
    }
    expect(assign).toHaveBeenCalledWith('/checkout')
  })

  test('a full bridge is passed through, and later bridge props are used', async () => {
    const boot = fakeBootstrap()
    const navigate1 = rs.fn()
    const navigate2 = rs.fn()
    const bridgeProps = (navigate: (href: string) => void) => ({
      navigate,
      prefetch: () => {},
      basePath: '/base',
      locale: 'fr',
    })
    render(mount({ boot, bridge: bridgeProps(navigate1) }))
    await boot.resolveAll()
    const { bridge } = boot.mounts[0]!.options
    expect(bridge.basePath).toBe('/base')
    expect(bridge.locale).toBe('fr')
    render(mount({ boot, bridge: bridgeProps(navigate2) }))
    bridge.navigate('/x')
    expect(navigate1).not.toHaveBeenCalled()
    expect(navigate2).toHaveBeenCalledWith('/x')
  })

  test('the module adds no property to globalThis', async () => {
    const before = new Set(Reflect.ownKeys(globalThis))
    const boot = fakeBootstrap()
    render(mount({ boot }))
    await boot.resolveAll()
    render(mount({ boot, envelope: envelope({ buildId: 'b2' }) }))
    await boot.resolveAll()
    render(null)
    await tick()
    const added = Reflect.ownKeys(globalThis).filter((k) => !before.has(k))
    expect(added).toEqual([])
    expect('__nf_liveRoots' in globalThis).toBe(false)
    for (const file of [
      'island-mount.tsx',
      'island-registry.ts',
      'events.ts',
    ]) {
      expect(readFileSync(`packages/react/src/${file}`, 'utf8')).not.toMatch(
        /globalThis|window\s*\.\s*__/
      )
    }
  })

  test('source keeps "use client" and the bundler-ignore comments on the bootstrap import', () => {
    const source = readFileSync('packages/react/src/island-mount.tsx', 'utf8')
    expect(source).toMatch(/^['"]use client['"]/)
    expect(source).toMatch(
      /import\(\s*\/\* webpackIgnore: true \*\/\s*\/\* turbopackIgnore: true \*\/\s*\/\* @vite-ignore \*\/\s*url\s*\)/
    )
  })
})

function mountProps(boot: FakeBoot): IslandMountProps {
  return { envelope: envelope(), loadBootstrap: boot.loadBootstrap }
}

describe('IslandMount token wiring', () => {
  test('options.getToken resolves null when no token prop is given', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot }))
    await boot.resolveAll()
    const { getToken } = boot.mounts[0]!.options
    expect(await getToken!()).toBeNull()
  })

  test('options.getToken fetches through the token client when a token prop is given', async () => {
    clearIslandTokens()
    const boot = fakeBootstrap()
    const calls: string[] = []
    const fetchSpy = rs.spyOn(globalThis, 'fetch').mockImplementation((async (
      url: unknown
    ) => {
      calls.push(String(url))
      return new Response(
        JSON.stringify({
          token: 'tk',
          expiresAt: Date.now() / 1000 + 600,
          identityKey: 'u1',
        }),
        { status: 200 }
      )
    }) as typeof fetch)
    try {
      render(
        mount({
          boot,
          token: { endpoint: '/api/nf/token?aud=shop', identityKey: 'u1' },
        })
      )
      await boot.resolveAll()
      const { getToken } = boot.mounts[0]!.options
      expect(await getToken!()).toBe('tk')
      expect(calls).toEqual(['/api/nf/token?aud=shop'])
    } finally {
      fetchSpy.mockRestore()
      clearIslandTokens()
    }
  })
})

describe('IslandMount Server Action wiring', () => {
  function tokenFetch() {
    const calls: string[] = []
    let n = 0
    const spy = rs.spyOn(globalThis, 'fetch').mockImplementation((async (
      url: unknown
    ) => {
      calls.push(String(url))
      n++
      return new Response(
        JSON.stringify({
          token: `${new URL(String(url), 'http://h').searchParams.get('aud')}-${n}`,
          expiresAt: Date.now() / 1000 + 600,
          identityKey: 'u1',
        }),
        { status: 200 }
      )
    }) as typeof fetch)
    return { calls, spy }
  }

  test('mountIsland gets the envelope island name', async () => {
    const boot = fakeBootstrap()
    render(mount({ boot, envelope: envelope({ island: 'Cart' }) }))
    await boot.resolveAll()
    expect(boot.mounts[0]!.options.envelope).toEqual({
      remote: 'shop',
      buildId: 'b1',
      mode: 'development',
      island: 'Cart',
    })
  })

  test('onAction reports become island:action events, on onEvent and the DOM', async () => {
    const boot = fakeBootstrap()
    const onEvent = rs.fn()
    const bubbled: CustomEvent[] = []
    const listener = (e: Event) => bubbled.push(e as CustomEvent)
    document.addEventListener(ISLAND_EVENT, listener)
    try {
      render(mount({ boot, onEvent }))
      await boot.resolveAll()
      const { onAction } = boot.mounts[0]!.options
      act(() =>
        onAction!({
          ok: false,
          status: 401,
          code: 'NF-014',
          ms: 12,
          retried: true,
        })
      )
    } finally {
      document.removeEventListener(ISLAND_EVENT, listener)
    }
    const action = {
      type: 'island:action',
      remote: 'shop',
      buildId: 'b1',
      ok: false,
      status: 401,
      code: 'NF-014',
      ms: 12,
      retried: true,
    }
    expect(onEvent).toHaveBeenLastCalledWith(action)
    expect(bubbled.at(-1)!.detail).toEqual(action)
    expect(bubbled.at(-1)!.target).toBe(islandEl())
  })

  test("invalidateToken drops only this mount's endpoint", async () => {
    clearIslandTokens()
    const { calls, spy } = tokenFetch()
    try {
      const boot = fakeBootstrap()
      render(
        <>
          <IslandMount
            envelope={envelope()}
            loadBootstrap={boot.loadBootstrap}
            token={{ endpoint: '/t?aud=shop', identityKey: 'u1' }}
          />
          <IslandMount
            envelope={envelope({ remote: 'blog' })}
            loadBootstrap={boot.loadBootstrap}
            token={{ endpoint: '/t?aud=blog', identityKey: 'u1' }}
          />
        </>
      )
      await boot.resolveAll()
      const [shop, blog] = boot.mounts.map((m) => m.options)
      const shopToken = await shop!.getToken!()
      const blogToken = await blog!.getToken!()
      expect(calls).toHaveLength(2)
      shop!.invalidateToken!(shopToken!)
      expect(await shop!.getToken!()).not.toBe(shopToken)
      expect(await blog!.getToken!()).toBe(blogToken)
      expect(calls).toEqual(['/t?aud=shop', '/t?aud=blog', '/t?aud=shop'])
    } finally {
      spy.mockRestore()
      clearIslandTokens()
    }
  })

  test('concurrent 401s for one endpoint trigger a single token refetch', async () => {
    clearIslandTokens()
    const { calls, spy } = tokenFetch()
    try {
      const boot = fakeBootstrap()
      const token = { endpoint: '/t?aud=shop', identityKey: 'u1' }
      render(
        <>
          <IslandMount
            envelope={envelope()}
            loadBootstrap={boot.loadBootstrap}
            token={token}
          />
          <IslandMount
            envelope={envelope()}
            loadBootstrap={boot.loadBootstrap}
            token={token}
          />
        </>
      )
      await boot.resolveAll()
      const [a, b] = boot.mounts.map((m) => m.options)
      const stale = await a!.getToken!()
      expect(await b!.getToken!()).toBe(stale)
      a!.invalidateToken!(stale!)
      const fromA = a!.getToken!()
      b!.invalidateToken!(stale!)
      const fromB = b!.getToken!()
      expect(await fromA).toBe(await fromB)
      expect(await fromA).not.toBe(stale)
      expect(calls).toHaveLength(2)
    } finally {
      spy.mockRestore()
      clearIslandTokens()
    }
  })
})
