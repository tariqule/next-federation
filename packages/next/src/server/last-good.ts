import type { IslandResult, IslandTarget } from '@next-federation/core'

type GoodResult = Extract<IslandResult, { ok: true }>

/** A public island's last good envelope, served while its remote fails (stale-if-error). */
export type KeptIsland = { result: GoodResult; ageSeconds: number }

// Last good public envelope per island request, in this server process.
// Not a cache: every render still goes through the island cache, so Next
// sees every fetch. Bounded by count and by total bytes (envelopes and keys,
// which hold the props); the oldest entry goes first (a Map keeps insertion
// order, and a refresh re-inserts).
const kept = new Map<string, { result: GoodResult; at: number }>()
const MAX_ENTRIES = 500
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
let totalBytes = 0

/** One entry per remote origin, island, props and host context. */
export function lastGoodKey(
  target: IslandTarget,
  island: string,
  propsJson: string,
  hostJson: string
): string {
  return JSON.stringify([
    target.origin,
    target.remote,
    island,
    propsJson,
    hostJson,
  ])
}

/**
 * How long a last good envelope may stand in for a failing remote: the
 * island cache entry's own `expire` (at least an hour, at least twice
 * `revalidate`), the longest Next would serve that entry stale.
 */
export function keepSeconds(revalidate: number): number {
  return Math.max(3600, revalidate * 2)
}

/** What an entry counts against the budget: its envelope and its key (up to 2 bytes a character). */
function entryBytes(key: string, result: GoodResult): number {
  return result.meta.bytes + key.length * 2
}

/**
 * Whether a failure may be answered with the last good envelope. Not for
 * the remote's own JSON 404 (`NF-021`, an island it no longer exposes): that
 * is a deliberate removal, not an outage. A 404 that is not the protocol's
 * (`not-an-island-remote`: a proxy, a CDN or a website in front) may be one.
 */
export function servesStale(failure: IslandResult): boolean {
  if (failure.ok) return false
  return !(failure.status === 404 && failure.hint === undefined)
}

/** Records a good result. `at` is when it was fetched (ms since the epoch). */
export function rememberGood(
  key: string,
  result: GoodResult,
  at: number
): void {
  const previous = kept.get(key)
  if (previous) {
    if (previous.at > at) return
    kept.delete(key)
    totalBytes -= entryBytes(key, previous.result)
  }
  kept.set(key, { result, at })
  totalBytes += entryBytes(key, result)
  for (const [oldest, entry] of kept) {
    if (kept.size <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) break
    if (oldest === key) break
    kept.delete(oldest)
    totalBytes -= entryBytes(oldest, entry.result)
  }
}

/**
 * The last good result for `key`, when it was fetched at most `maxSeconds`
 * before `now` (the time the failing fetch ran), else null.
 */
export function lastGood(
  key: string,
  now: number,
  maxSeconds: number
): KeptIsland | null {
  const entry = kept.get(key)
  if (!entry) return null
  const ageSeconds = Math.max(0, Math.round((now - entry.at) / 1000))
  if (ageSeconds > maxSeconds) return null
  return { result: entry.result, ageSeconds }
}

/** @internal Tests only. */
export function clearLastGood(): void {
  kept.clear()
  totalBytes = 0
}
