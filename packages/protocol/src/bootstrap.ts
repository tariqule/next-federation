import type { IslandEnvelope } from './envelope.ts'

export type IslandBridge = {
  navigate(href: string): void
  prefetch(href: string): void
  basePath: string
  locale: string
}

export type IslandErrorKind = 'uncaught' | 'caught' | 'recoverable'

/** One Server Action call, as reported to the host. Never carries arguments or tokens. */
export type ActionReport = {
  ok: boolean
  /** HTTP status of the final attempt; 0 when the request never got a response. */
  status: number
  code?: string
  /** Wall time of the call including a retry, in milliseconds. */
  ms: number
  /** True when the call was resent once with a fresh token. */
  retried: boolean
}

export type MountIslandOptions = {
  envelope: Pick<IslandEnvelope, 'remote' | 'buildId' | 'mode' | 'island'>
  /** Already prefixed by the host (see `applyIdPrefix`). */
  rscPayload: string
  identifierPrefix: string
  bridge: IslandBridge
  /** Identity token for Server Action calls (null when signed out). */
  getToken?: () => Promise<string | null>
  /**
   * Drops the cached token so the next `getToken` fetches a fresh one. Receives the token
   * the remote rejected, so a host can ignore it when it already holds a newer one.
   */
  invalidateToken?: (rejected: string) => void
  /** Called once per Server Action call. */
  onAction?: (report: ActionReport) => void
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
