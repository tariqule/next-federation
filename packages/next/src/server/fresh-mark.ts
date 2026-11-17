import type { IslandResult } from '@next-federation/core'

/**
 * An island-cache result; `fresh` is set by the run that actually fetched,
 * `at` is when that run fetched (ms since the epoch), read inside the cached
 * function so the caller never reads the wall clock.
 */
export type MarkedIslandResult = IslandResult & { fresh?: string; at?: number }

// Marks of fetches that ran in this process and are not yet reported. A
// cached entry carries the mark of the run that filled it, which was taken
// (or never added here, for another process or a build), so a hit is never
// reported as a fresh fetch. A run nobody awaits (background revalidation)
// leaves its mark behind, so the set is bounded.
const pending = new Set<string>()
const MAX_PENDING = 1000

/** Called inside the island cache when the fetch really ran, at `at`. */
export function markFresh(
  result: IslandResult,
  at?: number
): MarkedIslandResult {
  const mark = crypto.randomUUID()
  pending.add(mark)
  if (pending.size > MAX_PENDING) {
    pending.delete(pending.values().next().value!)
  }
  return at === undefined
    ? { ...result, fresh: mark }
    : { ...result, fresh: mark, at }
}

/** True exactly once for a result whose fetch ran in this process. */
export function takeFresh(result: MarkedIslandResult): boolean {
  return result.fresh !== undefined && pending.delete(result.fresh)
}
