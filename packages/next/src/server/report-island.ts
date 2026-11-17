import { eventFor, islandFailureDetail } from '@next-federation/core'
import type {
  Federation,
  IslandResult,
  IslandTarget,
} from '@next-federation/core'
import { logger } from '@next-federation/sdk'

/**
 * Reports one island load: emits `island:fetch` / `island:error`, logs a
 * failure with its NF code and, in development, warns once (NF-024) when the
 * envelope is larger than `islands.warnBytes`. Runs after the load, never
 * inside a cached function, and is shared by both routers. `keptAgeSeconds`:
 * the failure renders the island's last good envelope, this old, instead of
 * the fallback.
 */
export function reportIsland(
  federation: Federation,
  target: IslandTarget,
  island: string,
  result: IslandResult,
  keptAgeSeconds?: number
): void {
  federation.emit(eventFor(target, island, result))
  if (!result.ok) {
    // The URL (never its query), the status, and a hint for an origin that
    // is not an island remote.
    const detail = islandFailureDetail(result)
    const rendering =
      keptAgeSeconds === undefined
        ? 'its fallback'
        : `its last good envelope (${keptAgeSeconds} s old)`
    logger.error(
      result.code,
      `Island "${island}" from remote "${target.remote}" failed${detail ? ` ${detail}` : ''}; rendering ${rendering}.`
    )
    return
  }
  if (
    process.env.NODE_ENV === 'development' &&
    result.meta.bytes > federation.islands.warnBytes
  ) {
    logger.warnOnce(
      'NF-024',
      `${target.remote}:${island}`,
      `Island "${island}" from remote "${target.remote}" is ${result.meta.bytes} bytes (warnBytes ${federation.islands.warnBytes}).`
    )
  }
}
