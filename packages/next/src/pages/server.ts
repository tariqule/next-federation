export { createFederationApiHandler } from './api-handler.ts'
export type { PagesIdentity } from './api-handler.ts'
export { createPagesIslands } from './create-pages-islands.ts'
export type { IslandProps, PagesIslandSpec } from './create-pages-islands.ts'
export { getComponentDescriptor } from './component-descriptor.ts'
export type {
  ComponentDescriptorOptions,
  RemoteComponentDescriptor,
} from '../server/component-descriptor.ts'
export { preloadRemoteComponent } from '@next-federation/react/components'
