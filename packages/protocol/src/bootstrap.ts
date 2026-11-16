import type { IslandEnvelope } from './envelope.ts'

export type IslandBridge = {
  navigate(href: string): void
  prefetch(href: string): void
  basePath: string
  locale: string
}

export type IslandErrorKind = 'uncaught' | 'caught' | 'recoverable'

export type MountIslandOptions = {
  envelope: Pick<IslandEnvelope, 'remote' | 'buildId' | 'mode'>
  /** Already prefixed by the host (see `applyIdPrefix`). */
  rscPayload: string
  identifierPrefix: string
  bridge: IslandBridge
  /** Used from Phase 3. */
  getToken?: () => Promise<string | null>
  onError?: (error: unknown, kind: IslandErrorKind) => void
}

export type IslandHandle = {
  update(next: { rscPayload: string }): void
  destroy(): void
}

/** The contract of the ES module named by `IslandEnvelope.bootstrap`. */
export type IslandBootstrapModule = {
  mountIsland(container: HTMLElement, options: MountIslandOptions): IslandHandle
}
