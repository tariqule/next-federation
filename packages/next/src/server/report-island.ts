import { eventFor } from '@next-federation/core'
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
 * inside a cached function, and is shared by both routers.
 */
export function reportIsland(
  federation: Federation,
  target: IslandTarget,
  island: string,
  result: IslandResult
): void {
  federation.emit(eventFor(target, island, result))
  if (!result.ok) {
    const status = result.status === undefined ? '' : ` (HTTP ${result.status})`
    logger.error(
      result.code,
      `Island "${island}" from remote "${target.remote}" failed${status}; rendering its fallback.`
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
