'use client'

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { preinit } from 'react-dom'
import type { ReactElement, ReactNode } from 'react'
import { applyIdPrefix } from '@next-federation/protocol'
import type {
  IslandBootstrapModule,
  IslandBridge,
  IslandEnvelope,
  IslandErrorKind,
  IslandHandle,
} from '@next-federation/protocol'
import { isNFError } from '@next-federation/sdk'
import { createTokenClient } from './token-client.ts'
import type { TokenClient } from './token-client.ts'
import { emitIslandEvent } from './events.ts'
import { isHostReactProvided } from './host-react.ts'
import type { IslandClientEvent } from './events.ts'
import {
  destroyEntry,
  getEntry,
  registerEntry,
  sweep,
} from './island-registry.ts'
import type { IslandEntry } from './island-registry.ts'

export type IslandMountProps = {
  envelope: IslandEnvelope
  bridge?: Partial<IslandBridge>
  /** Per-user islands: the host's token endpoint for this remote and the identity it renders for. */
  token?: { endpoint: string; identityKey: string | null } | null
  /**
   * Rendered in place of the island after an uncaught island error. It stays
   * for that build: an envelope with a new `buildId` or `bootstrap` URL
   * renders a fresh container and bootstraps the island again.
   */
  errorFallback?: ReactNode
  onEvent?: (event: IslandClientEvent) => void
  /** Test seam; defaults to a native `import()` of the remote URL. */
  loadBootstrap?: (url: string) => Promise<IslandBootstrapModule>
}

// The comments keep host bundlers from resolving or bundling the remote URL.
const defaultLoadBootstrap = (url: string): Promise<IslandBootstrapModule> =>
  import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url
  )

/**
 * The island's stylesheets are React 19 stylesheet resources. React loads each
 * href once across all islands, never removes one, and inserts it in
 * `<head>` in its own precedence group, after Next's CSS. In server HTML it is
 * emitted ahead of the island markup: in `<head>` when React renders the
 * document (App Router), at the start of the app's HTML otherwise (Pages
 * Router), so a server-rendered island never paints unstyled. A mount on the
 * client (SPA, client navigation) inserts the stylesheets with `preinit`
 * instead of rendering `<link precedence>`: a rendered one would hold the
 * whole commit (the host's navigation) until it loads, up to 60 s for a
 * stalled stylesheet.
 */
const ISLAND_CSS_PRECEDENCE = 'next-federation'

const noSubscribe = (): (() => void) => () => {}

const now = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now()

/**
 * Mounts and hydrates a remote island (design §6, island mount lifecycle).
 *
 * The HTML is written once, on first render. The island root lives in a
 * registry keyed to the container node, so effect re-runs (StrictMode, hidden
 * `<Activity>`) never unmount it; it is torn down only once the node has left
 * the document. Same-build envelopes are applied with `update`; a new
 * `buildId` or `bootstrap` URL re-bootstraps the island in place. It renders
 * the envelope's stylesheets itself, so no host adds links for them.
 */
export function IslandMount(props: IslandMountProps): ReactElement {
  const { envelope } = props
  const mountId = useId()
  const ref = useRef<HTMLDivElement>(null)
  // Rule 1: the HTML a container node is created with. Computed once and never
  // rewritten by later renders; replaced only when a failed island recovers on
  // a new build, which renders a new node.
  const [frozen, setFrozen] = useState(() => ({
    envelope,
    html: applyIdPrefix(envelope, mountId).html,
  }))
  // Set when the effect rewrote a node's HTML (re-bootstrap).
  const rewritten = useRef<{ el: HTMLElement; envelope: IslandEnvelope }>(null)
  // The build that hit an uncaught error; its fallback shows until the build changes.
  const [failedBuild, setFailedBuild] = useState<{
    buildId: string
    bootstrap: string
  } | null>(null)
  const failed =
    failedBuild !== null &&
    failedBuild.buildId === envelope.buildId &&
    failedBuild.bootstrap === envelope.bootstrap
  if (failedBuild !== null && !failed) {
    setFailedBuild(null)
    setFrozen({ envelope, html: applyIdPrefix(envelope, mountId).html })
  }
  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  })
  // False when this node is rendered on the server or hydrated, true when it
  // first mounts on the client; kept for the node's life.
  const clientNow = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  )
  const [clientMount] = useState(clientNow)
  const css = [...new Set(envelope.css)]
  if (clientMount) {
    for (const href of css) {
      preinit(href, { as: 'style', precedence: ISLAND_CSS_PRECEDENCE })
    }
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    sweep()

    const emit = (event: IslandClientEvent) =>
      emitIslandEvent(el, event, latest.current.onEvent)
    const isCurrent = (entry: IslandEntry) =>
      el.isConnected && getEntry(el) === entry

    const bridge: IslandBridge = {
      navigate(href) {
        const navigate = latest.current.bridge?.navigate
        if (navigate) navigate(href)
        else window.location.assign(href)
      },
      prefetch(href) {
        latest.current.bridge?.prefetch?.(href)
      },
      get basePath() {
        return latest.current.bridge?.basePath ?? ''
      },
      get locale() {
        return latest.current.bridge?.locale ?? ''
      },
    }

    // Built lazily from the latest `token` prop; nothing is fetched until the
    // island asks for a token.
    let client: { key: string; value: TokenClient } | null = null
    const getToken = (): Promise<string | null> => {
      const token = latest.current.token
      if (!token) return Promise.resolve(null)
      const key = `${token.identityKey ?? ''}\u0000${token.endpoint}`
      if (client?.key !== key) client = { key, value: createTokenClient(token) }
      return client.value.getToken()
    }

    const markInert = (entry: IslandEntry, error: unknown) => {
      el.dataset.nfState = 'inert'
      emit({
        type: 'island:error',
        remote: entry.original.remote,
        buildId: entry.buildId,
        kind: 'bootstrap',
        code: isNFError(error) ? error.code : 'NF-011',
        error,
      })
    }

    const onIslandError = (
      entry: IslandEntry,
      error: unknown,
      kind: IslandErrorKind
    ) => {
      // An uncaught error from a root that was already replaced (re-bootstrap)
      // is reported but must not take down the island now in the container.
      const fails = kind === 'uncaught' && isCurrent(entry)
      if (fails) el.dataset.nfState = 'failed'
      emit({
        type: 'island:error',
        remote: entry.original.remote,
        buildId: entry.buildId,
        kind,
        code: 'NF-012',
        error,
      })
      if (!fails) return
      // Deferred: this runs inside the island React's commit, where a
      // synchronous unmount of its own root is not allowed.
      queueMicrotask(() => {
        destroyEntry(entry)
        setFailedBuild({ buildId: entry.buildId, bootstrap: entry.bootstrap })
      })
    }

    const boot = (entry: IslandEntry) => {
      const started = now()
      const load = latest.current.loadBootstrap ?? defaultLoadBootstrap
      let loading: Promise<IslandBootstrapModule>
      try {
        loading = Promise.resolve(load(entry.bootstrap))
      } catch (error) {
        loading = Promise.reject(error)
      }
      loading.then(
        (mod) => {
          // Rule 3: unmounted, swapped or re-bootstrapped while loading.
          if (!isCurrent(entry) || entry.handle) return
          const { remote, buildId, mode } = entry.original
          const original = applyIdPrefix(entry.original, mountId)
          let handle: IslandHandle
          try {
            handle = mod.mountIsland(el, {
              envelope: { remote, buildId, mode },
              rscPayload: original.rscPayload,
              identifierPrefix: original.identifierPrefix,
              bridge,
              getToken,
              onError: (error, kind) => onIslandError(entry, error, kind),
            })
          } catch (error) {
            markInert(entry, error)
            return
          }
          if (!isCurrent(entry)) {
            // Destroyed or replaced while mountIsland ran: do not keep the root.
            handle.destroy()
            return
          }
          entry.handle = handle
          // Live only once hydration committed: before that, clicks would be
          // lost and an update would make React client-render the root.
          const onHydrated = () => {
            if (!isCurrent(entry) || entry.handle !== handle) return
            entry.hydrated = true
            if (entry.latest !== entry.original) {
              handle.update({
                rscPayload: applyIdPrefix(entry.latest, mountId).rscPayload,
              })
            }
            el.dataset.nfState = 'live'
            emit({
              type: 'island:hydrate',
              remote,
              buildId,
              ms: now() - started,
            })
          }
          // A bootstrap without the signal counts as hydrated on return.
          if (handle.hydrated) {
            // The contract never rejects; if one does, it is an island failure.
            handle.hydrated.then(onHydrated, (error: unknown) =>
              onIslandError(entry, error, 'uncaught')
            )
          } else onHydrated()
        },
        (error: unknown) => {
          if (isCurrent(entry)) markInert(entry, error)
        }
      )
    }

    let entry = getEntry(el)
    let needsBoot = false
    if (!entry) {
      // First effect for this node: hydrate with the envelope its HTML came from.
      const source =
        rewritten.current?.el === el
          ? rewritten.current.envelope
          : frozen.envelope
      entry = registerEntry(el, source)
      needsBoot = true
    }
    const sameBuild = (a: IslandEntry, b: IslandEnvelope) =>
      a.buildId === b.buildId && a.bootstrap === b.bootstrap
    // Rule 5: the remote redeployed; the only case where the HTML is replaced.
    const rebootstrap = (stale: IslandEntry, next: IslandEnvelope) => {
      destroyEntry(stale)
      el.innerHTML = applyIdPrefix(next, mountId).html
      rewritten.current = { el, envelope: next }
      el.dataset.nfState = 'booting'
      boot(registerEntry(el, next))
    }
    if (!sameBuild(entry, envelope)) {
      needsBoot = false
      if (entry.handle && isHostReactProvided()) {
        // The old root may run on the very React that runs this effect
        // (provideHostReact). React would postpone its unmount until after
        // this effect, i.e. after the HTML below is replaced, so the swap
        // runs once the effect is over, for the newest envelope by then.
        queueMicrotask(() => {
          const stale = getEntry(el)
          const next = latest.current.envelope
          if (!el.isConnected || !stale || sameBuild(stale, next)) return
          rebootstrap(stale, next)
        })
      } else rebootstrap(entry, envelope)
    } else if (entry.latest !== envelope) {
      // Rule 4: only the new payload; no DOM write, no remote fetch. Before
      // hydration it is only recorded; the hydration callback applies it.
      entry.latest = envelope
      if (entry.hydrated) {
        entry.handle?.update({
          rscPayload: applyIdPrefix(envelope, mountId).rscPayload,
        })
      }
    }
    if (needsBoot) boot(entry)

    // Rule 2: never unmount here. A node that is still connected (effect
    // re-run, StrictMode, hidden <Activity>) keeps its root.
    return () => {
      setTimeout(() => {
        if (el.isConnected) return
        const stale = getEntry(el)
        if (stale) destroyEntry(stale)
      }, 0)
    }
  }, [envelope, mountId, frozen])

  if (failed) return <>{props.errorFallback ?? null}</>
  return (
    <>
      {clientMount
        ? null
        : css.map((href) => (
            <link
              key={href}
              rel="stylesheet"
              href={href}
              precedence={ISLAND_CSS_PRECEDENCE}
            />
          ))}
      <div
        ref={ref}
        data-nf-root=""
        data-nf-remote={envelope.remote}
        data-nf-build={envelope.buildId}
        data-nf-state="booting"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: frozen.html }}
      />
    </>
  )
}
