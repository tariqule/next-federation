import type { IslandEnvelope, IslandHandle } from '@next-federation/protocol'
import { logger } from '@next-federation/sdk'
import {
  destroyEntry,
  getEntry,
  getLiveIslandCount,
  registerEntry,
  SWEEP_INTERVAL_MS,
  sweep,
} from '../src/island-registry.ts'

const envelope = {
  remote: 'shop',
  buildId: 'b1',
  bootstrap: 'https://shop.example.com/_nf/b1/bootstrap.js',
} as IslandEnvelope

function handle(): IslandHandle & { destroy: ReturnType<typeof rs.fn> } {
  return { update: rs.fn(), destroy: rs.fn() }
}

const nodes: HTMLElement[] = []
function node(connected = true): HTMLElement {
  const el = document.createElement('div')
  if (connected) document.body.appendChild(el)
  nodes.push(el)
  return el
}

afterEach(() => {
  for (const el of nodes.splice(0)) {
    const entry = getEntry(el)
    if (entry) destroyEntry(entry)
    el.remove()
  }
  rs.restoreAllMocks()
})

describe('island registry', () => {
  test('entries are keyed to the container node', () => {
    const el = node()
    const entry = registerEntry(el, envelope)
    expect(getEntry(el)).toBe(entry)
    expect(getEntry(node())).toBeUndefined()
    expect(entry).toMatchObject({
      el,
      handle: null,
      original: envelope,
      latest: envelope,
      buildId: 'b1',
      bootstrap: envelope.bootstrap,
    })
  })

  test('the live count only counts hydrated roots', () => {
    const a = registerEntry(node(), envelope)
    registerEntry(node(), envelope)
    expect(getLiveIslandCount()).toBe(0)
    a.handle = handle()
    expect(getLiveIslandCount()).toBe(1)
  })

  test('destroyEntry destroys the handle once and forgets the node', () => {
    const el = node()
    const entry = registerEntry(el, envelope)
    const h = handle()
    entry.handle = h
    destroyEntry(entry)
    destroyEntry(entry)
    expect(h.destroy).toHaveBeenCalledTimes(1)
    expect(entry.handle).toBeNull()
    expect(getEntry(el)).toBeUndefined()
    expect(getLiveIslandCount()).toBe(0)
  })

  test('destroying a stale entry keeps a newer entry for the same node', () => {
    const el = node()
    const stale = registerEntry(el, envelope)
    const fresh = registerEntry(el, envelope)
    destroyEntry(stale)
    expect(getEntry(el)).toBe(fresh)
  })

  test('sweep destroys only entries whose node left the document', () => {
    const kept = registerEntry(node(), envelope)
    const goneEl = node()
    const gone = registerEntry(goneEl, envelope)
    const keptHandle = handle()
    const goneHandle = handle()
    kept.handle = keptHandle
    gone.handle = goneHandle
    goneEl.remove()
    sweep()
    expect(goneHandle.destroy).toHaveBeenCalledTimes(1)
    expect(keptHandle.destroy).not.toHaveBeenCalled()
    expect(getEntry(goneEl)).toBeUndefined()
    expect(getLiveIslandCount()).toBe(1)
  })

  test('getLiveIslandCount sweeps detached roots first', () => {
    const el = node()
    const entry = registerEntry(el, envelope)
    const h = handle()
    entry.handle = h
    el.remove()
    expect(getLiveIslandCount()).toBe(0)
    expect(h.destroy).toHaveBeenCalledTimes(1)
  })

  test('a background sweep runs only while islands are registered', () => {
    rs.useFakeTimers()
    try {
      expect(rs.getTimerCount()).toBe(0)
      const el = node()
      const entry = registerEntry(el, envelope)
      const h = handle()
      entry.handle = h
      expect(rs.getTimerCount()).toBe(1)
      el.remove()
      rs.advanceTimersByTime(SWEEP_INTERVAL_MS)
      expect(h.destroy).toHaveBeenCalledTimes(1)
      expect(getEntry(el)).toBeUndefined()
      expect(rs.getTimerCount()).toBe(0)
    } finally {
      rs.useRealTimers()
    }
  })

  test('a throwing destroy is logged and the entry is still removed', () => {
    const error = rs.spyOn(logger, 'error').mockImplementation(() => {})
    const el = node()
    const entry = registerEntry(el, envelope)
    const failure = new Error('unmount failed')
    entry.handle = {
      update() {},
      destroy() {
        throw failure
      },
    }
    destroyEntry(entry)
    expect(getEntry(el)).toBeUndefined()
    expect(getLiveIslandCount()).toBe(0)
    expect(error).toHaveBeenCalledWith('NF-012', expect.any(String), failure)
  })
})
