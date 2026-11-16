import 'server-only'

export { createIslands } from './create-islands.tsx'
export type { RemoteIslandProps } from './create-islands.tsx'
export type { AppIdentity, IslandSpec } from './load-island.ts'
export { getComponentDescriptor } from './get-component-descriptor.ts'
export type {
  ComponentDescriptorOptions,
  RemoteComponentDescriptor,
} from './component-descriptor.ts'
