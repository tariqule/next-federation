import type { ActionReport, IslandErrorKind } from '@next-federation/protocol'
import { logger } from '@next-federation/sdk'
import type { NFErrorCode } from '@next-federation/sdk'

/** Name of the bubbling DOM event every island container dispatches. */
export const ISLAND_EVENT = 'nf:island'

export type IslandClientEvent =
  | { type: 'island:hydrate'; remote: string; buildId: string; ms: number }
  | ({ type: 'island:action'; remote: string; buildId: string } & ActionReport)
  | {
      type: 'island:error'
      remote: string
      buildId: string
      kind: IslandErrorKind | 'bootstrap'
      code: NFErrorCode
      error: unknown
    }

/**
 * Sends an event to `onEvent` and dispatches it on the container as a bubbling
 * `CustomEvent`: functions cannot cross the App Router server/client boundary,
 * so the DOM event is the channel a server-rendered page can listen on.
 * Error events are also logged.
 */
export function emitIslandEvent(
  el: HTMLElement,
  event: IslandClientEvent,
  onEvent: ((event: IslandClientEvent) => void) | undefined
): void {
  if (event.type === 'island:error') {
    logger.error(
      event.code,
      `Island "${event.remote}" (build ${event.buildId}): ${event.kind} error.`,
      event.error
    )
  }
  if (onEvent) {
    try {
      onEvent(event)
    } catch (observerError) {
      // A broken observer must not break the island.
      logger.debug('IslandMount onEvent threw', observerError)
    }
  }
  el.dispatchEvent(
    new CustomEvent(ISLAND_EVENT, { detail: event, bubbles: true })
  )
}
