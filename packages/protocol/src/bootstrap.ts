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
  /** Updates sent before `hydrated` settles are held and the newest is applied after it. */
  update(next: { rscPayload: string }): void
  destroy(): void
  /**
   * Resolves once the island root's first commit (hydration) is done; the
   * island is interactive from then on. Never settles if the root fails or is
   * destroyed first. Optional for older bootstraps; a host treats a handle
   * without it as hydrated when `mountIsland` returns.
   */
  hydrated?: Promise<void>
}

/** The contract of the ES module named by `IslandEnvelope.bootstrap`. */
export type IslandBootstrapModule = {
  mountIsland(container: HTMLElement, options: MountIslandOptions): IslandHandle
}
