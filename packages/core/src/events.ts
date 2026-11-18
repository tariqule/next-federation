import { logger } from '@next-federation/sdk'
import type { NFErrorCode } from '@next-federation/sdk'

export type FederationEvent =
  | {
      type: 'island:fetch'
      remote: string
      island: string
      ms: number
      bytes: number
      attempts: number
    }
  | {
      type: 'island:error'
      remote: string
      island: string
      ms: number
      attempts: number
      code: NFErrorCode
      status?: number
    }
  | {
      /** A components remote's build descriptor was resolved. */
      type: 'component:descriptor'
      remote: string
      buildId: string
      /** The host may server-render this build (verified). */
      ssr: boolean
      ms: number
    }
  | {
      type: 'component:error'
      remote: string
      code: NFErrorCode
      ms: number
      status?: number
    }

/**
 * Calls `onEvent` and never throws. A throwing handler is caught and logged
 * with `logger.debug` (visible with `NF_DEBUG=1`); it has no error code and is
 * never surfaced to the caller, because a broken observer must not break
 * island rendering.
 */
export function safeEmit(
  onEvent: ((event: FederationEvent) => void) | undefined,
  event: FederationEvent
): void {
  if (!onEvent) return
  try {
    const result: unknown = onEvent(event)
    // An async handler that rejects must not become an unhandled rejection.
    if (
      typeof result === 'object' &&
      result !== null &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      ;(result as Promise<unknown>).then(undefined, (error: unknown) => {
        logger.debug('onEvent handler rejected', error)
      })
    }
  } catch (error) {
    logger.debug('onEvent handler threw', error)
  }
}
