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
  PreloadRemoteComponent,
  PreloadResult,
  PreloadState,
} from '@next-federation/react/components'

export const preloadRemoteComponent: base.PreloadRemoteComponent = ((
  descriptor: base.RemoteComponentDescriptor | null,
  expose: string,
  options?: base.PreloadOptions
) =>
  base.preloadRemoteComponent(
    descriptor,
    expose,
    options
  )) as base.PreloadRemoteComponent
