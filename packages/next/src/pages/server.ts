// Importing this entry registers the host's `next/link` and `next/router` (as
// `./components.tsx` does), so a preload from server code is not refused
// (NF-036) for modules the host provides.
import * as base from '@next-federation/react/components'
import { registerPagesShared } from './register-shared.ts'

registerPagesShared()
export { createFederationApiHandler } from './api-handler.ts'
export type { PagesIdentity } from './api-handler.ts'
export { createPagesIslands } from './create-pages-islands.ts'
export type { IslandProps, PagesIslandSpec } from './create-pages-islands.ts'
export { getComponentDescriptor } from './component-descriptor.ts'
export type {
  ComponentDescriptorOptions,
  RemoteComponentDescriptor,
} from '../server/component-descriptor.ts'
export type {
  PreloadOptions,
  PreloadResult,
  PreloadState,
} from '@next-federation/react/components'

export function preloadRemoteComponent(
  descriptor: base.RemoteComponentDescriptor | null,
  expose: string
): Promise<void>
export function preloadRemoteComponent(
  descriptor: base.RemoteComponentDescriptor | null,
  expose: string,
  options: base.PreloadOptions
): Promise<base.PreloadResult>
export function preloadRemoteComponent(
  descriptor: base.RemoteComponentDescriptor | null,
  expose: string,
  options?: base.PreloadOptions
): Promise<void | base.PreloadResult>
export function preloadRemoteComponent(
  descriptor: base.RemoteComponentDescriptor | null,
  expose: string,
  options?: base.PreloadOptions
): Promise<void | base.PreloadResult> {
  return base.preloadRemoteComponent(descriptor, expose, options)
}
