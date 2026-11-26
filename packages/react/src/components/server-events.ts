import { routeComponentEvent } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import type { ComponentEvent } from './runtime.ts'

/**
 * Server: hands a component event to the `onEvent` of the federation that
 * resolved the descriptor (its `events` key, set by `getComponentDescriptor`).
 * Without one, nothing is delivered; failures are still logged where they
 * happen.
 */
export function serverComponentEmit(
  event: ComponentEvent,
  descriptor: RemoteComponentDescriptor
): void {
  routeComponentEvent(descriptor, event)
}
