'use client'
// Host-side island mount (design §6 "Island mount: lifecycle rules").
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IslandEnvelope } from './protocol'

type Bridge = { navigate(href: string): void; prefetch(href: string): void; basePath: string; locale?: string }
type IslandHandle = { update(envelope: IslandEnvelope): void; destroy(): void; buildId: string }
type Bootstrap = {
  mountIsland(
    el: HTMLElement,
    opts: {
      envelope: IslandEnvelope
      mode: 'hydrate'
      bridge?: Partial<Bridge>
      callServer?: (id: string, args: unknown[]) => Promise<unknown>
      onError?: (e: unknown, kind: string) => void
    },
  ): IslandHandle
}

type Entry = { el: HTMLElement; handle: IslandHandle | null; latest: IslandEnvelope; buildId: string }

// Rule 3: the island root is keyed to the container DOM node, not to the effect.
const entries = new WeakMap<HTMLElement, Entry>()
const live = new Set<Entry>()

const loadBootstrap = (url: string): Promise<Bootstrap> =>
  import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url)

// Rule 4: tear down roots whose container left the document.
function sweep() {
  for (const e of live) {
    if (!e.el.isConnected) {
      e.handle?.destroy()
      live.delete(e)
      entries.delete(e.el)
    }
  }
}

export type IslandMountProps = {
  envelope: IslandEnvelope
  bridge?: Partial<Bridge>
  callServer?: (id: string, args: unknown[]) => Promise<unknown>
  onIslandError?: (error: unknown, kind: string) => void
  fallback?: ReactNode
}

const defaultOnError = (error: unknown, kind: string) => console.error(`[next-federation] island ${kind} error:`, error)

export function IslandMount({ envelope, bridge, callServer, onIslandError = defaultOnError }: IslandMountProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Rule 6: the HTML is written only on first render, then frozen.
  const [html] = useState(envelope.html)
  const opts = useRef({ bridge, callServer, onIslandError })
  opts.current = { bridge, callServer, onIslandError }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    sweep()
    let entry = entries.get(el)
    const start = (target: Entry) => {
      loadBootstrap(target.latest.bootstrap).then((m) => {
        if (!el.isConnected || entries.get(el) !== target || target.handle) return
        target.handle = m.mountIsland(el, {
          envelope: target.latest,
          mode: 'hydrate',
          bridge: opts.current.bridge,
          callServer: opts.current.callServer,
          onError: (e, kind) => opts.current.onIslandError?.(e, kind),
        })
        el.dataset.nfState = 'live'
      }, (e) => opts.current.onIslandError?.(e, 'bootstrap'))
    }
    if (!entry) {
      // First mount of this container (or a swapped-in container, rule 5).
      entry = { el, handle: null, latest: envelope, buildId: envelope.buildId }
      entries.set(el, entry)
      live.add(entry)
      start(entry)
    } else if (entry.buildId !== envelope.buildId) {
      // Remote redeployed: the only case where island HTML is replaced.
      entry.handle?.destroy()
      el.dataset.nfState = 'booting'
      el.innerHTML = envelope.html
      const next: Entry = { el, handle: null, latest: envelope, buildId: envelope.buildId }
      entries.set(el, next)
      live.delete(entry)
      live.add(next)
      start(next)
    } else if (entry.latest !== envelope) {
      // Rule 6: later updates apply only the new RSC payload.
      entry.latest = envelope
      entry.handle?.update(envelope)
    }
    // Rules 3/4: no unmount in cleanup (StrictMode / Activity safe); sweep() handles real removal.
  }, [envelope])

  return (
    <div
      ref={ref}
      data-nf-root=""
      data-nf-build={envelope.buildId}
      data-nf-state="booting"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
