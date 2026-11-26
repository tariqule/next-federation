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
      /** A remote component module loaded (server-side, routed by descriptor). */
      type: 'component:load'
      remote: string
      buildId: string
      expose: string
      ms: number
      env: 'server' | 'client'
      phase?: 'descriptor' | 'load' | 'render'
      outcome?: 'ready' | 'browser-only' | 'refused' | 'failed' | 'fallback'
    }
  | {
      type: 'component:error'
      remote: string
      code: NFErrorCode
      ms: number
      status?: number
      /** Set for a load or render failure (server-side, routed by descriptor). */
      buildId?: string
      expose?: string
      env?: 'server' | 'client'
      error?: unknown
      phase?: 'descriptor' | 'load' | 'render'
      outcome?: 'ready' | 'browser-only' | 'refused' | 'failed' | 'fallback'
    }
  | {
      /**
       * A degraded tree rendered in place of a remote component (refused,
       * browser-only on the server, a render error, a failed load). Never for
       * the loading placeholder of a pending load.
       */
      type: 'component:fallback'
      remote: string
      buildId: string
      expose: string
      env: 'server' | 'client'
      phase: 'render'
      reason: 'browser-only' | 'refused' | 'failed' | 'render-error'
      code?: NFErrorCode
      ms?: number
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
