import type { IslandEnvelope, IslandHandle } from '@next-federation/protocol'
import { logger } from '@next-federation/sdk'

/** One island root, keyed to its container node. */
export type IslandEntry = {
  el: HTMLElement
  /** Set once `mountIsland` returned; `null` while booting, inert or destroyed. */
  handle: IslandHandle | null
  /** True once the bootstrap reported that hydration committed. */
  hydrated: boolean
  /** Envelope the container's HTML came from; hydration must use this one. */
  original: IslandEnvelope
  /** Newest envelope seen; applied with `update` once hydrated. */
  latest: IslandEnvelope
  buildId: string
  bootstrap: string
}

// Keyed to the node, never to an effect: StrictMode and hidden <Activity>
// re-run effects on the same node, and must find the same root.
const entries = new WeakMap<HTMLElement, IslandEntry>()
// Strong references only for the sweep; an entry leaves on destroy.
const live = new Set<IslandEntry>()

/**
 * How often the background sweep runs while any island is registered. Needed
 * because a node removed while inside a hidden `<Activity>` gets no second
 * effect cleanup, so nothing else would notice it left the document.
 */
export const SWEEP_INTERVAL_MS = 1000
let sweepTimer: ReturnType<typeof setInterval> | null = null

function syncSweepTimer(): void {
  if (live.size === 0) {
    if (sweepTimer !== null) clearInterval(sweepTimer)
    sweepTimer = null
  } else if (sweepTimer === null && typeof setInterval === 'function') {
    sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS)
  }
}

export function getEntry(el: HTMLElement): IslandEntry | undefined {
  return entries.get(el)
}

/** Registers a fresh entry for `el`, replacing any previous one. */
export function registerEntry(
  el: HTMLElement,
  envelope: IslandEnvelope
): IslandEntry {
  const entry: IslandEntry = {
    el,
    handle: null,
    hydrated: false,
    original: envelope,
    latest: envelope,
    buildId: envelope.buildId,
    bootstrap: envelope.bootstrap,
  }
  entries.set(el, entry)
  live.add(entry)
  syncSweepTimer()
  return entry
}

/** Idempotent. Never forgets a newer entry registered for the same node. */
export function destroyEntry(entry: IslandEntry): void {
  const { handle } = entry
  entry.handle = null
  entry.hydrated = false
  live.delete(entry)
  if (entries.get(entry.el) === entry) entries.delete(entry.el)
  syncSweepTimer()
  if (!handle) return
  try {
    handle.destroy()
  } catch (error) {
    logger.error(
      'NF-012',
      `Island "${entry.original.remote}" (build ${entry.buildId}) failed to unmount.`,
      error
    )
  }
}

/** Tears down every root whose container left the document. */
export function sweep(): void {
  for (const entry of live) if (!entry.el.isConnected) destroyEntry(entry)
}

/** Number of island roots currently mounted on the page (hydrated or hydrating). */
export function getLiveIslandCount(): number {
  sweep()
  let n = 0
  for (const entry of live) if (entry.handle) n++
  return n
}
