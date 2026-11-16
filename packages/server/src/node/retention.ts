import { NFError } from '@next-federation/sdk'

export type BuildInfo = { buildId: string; builtAt: number }
export type Retention = { maxBuilds: number; minAgeMs: number }

export const DEFAULT_RETENTION: Retention = {
  maxBuilds: 3,
  minAgeMs: 86_400_000,
}

/**
 * A build is live when it is the current build, among the newest `maxBuilds`,
 * or younger than `minAgeMs`. Everything else is retired. Both lists are
 * newest-first.
 */
export function planRetention(
  builds: BuildInfo[],
  now: number,
  retention: Retention,
  current?: string
): { current: string; live: string[]; retired: string[] } {
  if (builds.length === 0) {
    throw new NFError('NF-002', 'No builds found: nothing to serve.')
  }
  const sorted = [...builds].sort(
    (a, b) => b.builtAt - a.builtAt || (a.buildId < b.buildId ? 1 : -1)
  )
  const currentId = current ?? sorted[0]!.buildId
  if (!sorted.some((b) => b.buildId === currentId)) {
    throw new NFError('NF-002', `Current build "${currentId}" does not exist.`)
  }
  const live: string[] = []
  const retired: string[] = []
  sorted.forEach((b, index) => {
    const keep =
      b.buildId === currentId ||
      index < retention.maxBuilds ||
      now - b.builtAt < retention.minAgeMs
    ;(keep ? live : retired).push(b.buildId)
  })
  return { current: currentId, live, retired }
}
