export { defineFederation } from './config.ts'
export type {
  Federation,
  FederationConfig,
  IslandTarget,
  RemoteConfig,
} from './config.ts'
export type { FederationEvent } from './events.ts'
export { eventFor, fetchIsland, islandTags } from './fetch-island.ts'
export type {
  FetchIslandRequest,
  IslandFailureCode,
  IslandFetchMeta,
  IslandResult,
} from './fetch-island.ts'
