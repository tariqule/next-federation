import { startTransition, use, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import type {
  IslandBootstrapModule,
  IslandBridge,
  IslandErrorKind,
  MountIslandOptions,
  ReactMode,
} from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import { BridgeProvider } from '../bridge-context.tsx'
import { createCallServer } from './call-server.ts'
import type { CallServer } from './call-server.ts'
import { registerFlightScope } from './flight-scope.ts'

export type IslandBootstrapDeps = {
  /** The build's absolute base URL; the flight-client registry slot. */
  scopeKey: string
  remote: string
  buildId: string
  mode: ReactMode
  loadClientReference(id: string): Promise<unknown>
  createFromReadableStream<T>(
    stream: ReadableStream<Uint8Array>,
    options: { callServer: CallServer }
  ): PromiseLike<T>
  /**
   * React's `encodeReply` from the same flight client. Enables Server Actions; without
   * it (bootstraps built by an older plugin) every action rejects with NF-019.
   */
  encodeReply?(args: unknown[]): Promise<string | FormData>
  /**
   * Server Actions reject with NF-038 when the remote has not started
   * answering within this many ms. Default: no limit.
   */
  actionTimeoutMs?: number
}

const toStream = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

// Defined once so an update keeps the same component type, and so client state.
function Island({ payload }: { payload: PromiseLike<ReactNode> }): ReactNode {
  return use(payload)
}

// Its layout effect runs in the root's first commit, i.e. once the payload
// resolved and hydration attached the event handlers.
function Committed({
  onCommit,
  children,
}: {
  onCommit: () => void
  children: ReactNode
}): ReactNode {
  useLayoutEffect(onCommit, [onCommit])
  return children
}

// Marks a container that holds a live island root. A symbol from the global
// registry, so every bootstrap on the page (any remote, any build) sees it.
const ROOT_MARK: unique symbol = Symbol.for('next-federation.island-root')
type MarkedContainer = HTMLElement & { [ROOT_MARK]?: true }

/**
 * Builds the browser module an envelope's `bootstrap` URL points at. The
 * flight client and the client-reference loader are injected by the bundler
 * plugin, so this runtime stays bundler-neutral.
 *
 * Server Actions: they must reach client components as props from server
 * components. A client module that imports a 'use server' function would get
 * a page-global callServer, which would cross islands. Each mount builds its
 * own callServer bound to this build's URL and that mount's token.
 */
export function createIslandBootstrap(
  deps: IslandBootstrapDeps
): IslandBootstrapModule {
  const modules = new Map<string, Promise<unknown>>()
  registerFlightScope(deps.scopeKey, {
    require(rawId) {
      const id = rawId.split('$$cache=')[0]!
      let mod = modules.get(id)
      if (!mod) {
        // A module of the island that cannot load (the remote is down, or the
        // build was retired) is a load failure, not an error of island code.
        mod = deps.loadClientReference(id).catch((error: unknown) => {
          throw new NFError('NF-011', `Island code "${id}" failed to load.`, {
            cause: error,
          })
        })
        modules.set(id, mod)
      }
      return mod
    },
    chunkLoad: () => Promise.resolve(),
  })

  return {
    mountIsland(container, options: MountIslandOptions) {
      const { envelope } = options
      if (
        envelope.buildId !== deps.buildId ||
        envelope.remote !== deps.remote
      ) {
        throw new NFError(
          'NF-010',
          `This bootstrap serves ${deps.remote}@${deps.buildId}, but the island payload is from ${envelope.remote}@${envelope.buildId}.`
        )
      }
      if (envelope.mode !== deps.mode) {
        throw new NFError(
          'NF-006',
          `The island was rendered in ${envelope.mode} mode but this bootstrap runs in ${deps.mode} mode.`
        )
      }
      const marked = container as MarkedContainer
      if (marked[ROOT_MARK]) {
        // A second hydrateRoot on one container would corrupt both roots.
        throw new NFError(
          'NF-012',
          'This container already holds a live island root; destroy it before mounting again.'
        )
      }
      // One per island root, so an action never uses another mount's URL or token.
      const { encodeReply } = deps
      const callServer: CallServer = encodeReply
        ? createCallServer({
            url: deps.scopeKey,
            island: envelope.island,
            getToken: options.getToken,
            invalidateToken: options.invalidateToken,
            onAction: options.onAction,
            ...(deps.actionTimeoutMs === undefined
              ? {}
              : { timeoutMs: deps.actionTimeoutMs }),
            encodeReply,
            createFromReadableStream: deps.createFromReadableStream,
          })
        : () =>
            Promise.reject(
              new NFError(
                'NF-019',
                'This bootstrap was built without Server Action support.'
              )
            )
      const { onError } = options
      // Without onError, React's default reporting stays in place so render
      // errors are never silent.
      // A root destroyed before it hydrated (the host unmounted it while it
      // was loading) gets a recoverable "early update" error from its own
      // unmount: not an island failure, so it is not reported.
      const report = (kind: IslandErrorKind) =>
        onError
          ? (error: unknown) => {
              if (destroyed && kind === 'recoverable') return
              onError(error, kind)
            }
          : undefined
      let destroyed = false
      let isHydrated = false
      // Newest payload sent before hydration finished. Rendering it earlier
      // would make React drop the server HTML and client-render the root.
      let pending: string | null = null
      let resolveHydrated!: () => void
      const hydrated = new Promise<void>((r) => (resolveHydrated = r))
      const render = (rscPayload: string) =>
        startTransition(() => root.render(tree(rscPayload, options.bridge)))
      const onCommit = () => {
        if (isHydrated) return
        isHydrated = true
        resolveHydrated()
        // After the commit, not inside it.
        queueMicrotask(() => {
          if (destroyed || pending === null) return
          const next = pending
          pending = null
          render(next)
        })
      }
      const tree = (rscPayload: string, bridge: IslandBridge) => (
        <BridgeProvider value={bridge}>
          <Committed onCommit={onCommit}>
            <Island
              payload={deps.createFromReadableStream<ReactNode>(
                toStream(rscPayload),
                { callServer }
              )}
            />
          </Committed>
        </BridgeProvider>
      )
      const root = hydrateRoot(
        container,
        tree(options.rscPayload, options.bridge),
        {
          identifierPrefix: options.identifierPrefix,
          ...(onError && {
            onUncaughtError: report('uncaught'),
            onCaughtError: report('caught'),
            onRecoverableError: report('recoverable'),
          }),
        }
      )
      marked[ROOT_MARK] = true
      return {
        update(next) {
          if (destroyed) return
          if (!isHydrated) {
            pending = next.rscPayload
            return
          }
          render(next.rscPayload)
        },
        destroy() {
          if (destroyed) return
          destroyed = true
          pending = null
          root.unmount()
          delete marked[ROOT_MARK]
        },
        hydrated,
      }
    },
  }
}
