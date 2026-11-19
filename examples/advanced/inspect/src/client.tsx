'use client'
// Demo only: the "How is this page built?" layer. Everything here reads the
// host's own data (props from the code that renders each piece) and the DOM
// (attributes the library puts on its island container, and the arrival
// records of ARRIVALS_SCRIPT). It never writes into island or component
// markup, and renders nothing until it is switched on after hydration, so
// the server HTML and the first client render are identical.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { REMOTES } from './remotes'
import type { EmbedInfo } from './remotes'

// --- the on/off switch (persisted per browser) -----------------------------

const STORAGE_KEY = 'example-inspect'
const listeners = new Set<() => void>()
let enabled: boolean | null = null

function readEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(STORAGE_KEY) === 'on'
    } catch {
      enabled = false
    }
  }
  return enabled
}

function setEnabled(on: boolean): void {
  enabled = on
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Private mode or blocked storage: the switch still works for this page.
  }
  // Nested outlines are host CSS keyed on this attribute (inspect.css).
  document.documentElement.toggleAttribute('data-inspect', on)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** False on the server and during hydration, then the stored choice. */
export function useInspect(): boolean {
  const on = useSyncExternalStore(subscribe, readEnabled, () => false)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-inspect', on)
  }, [on])
  return on
}

export function InspectToggle() {
  const on = useInspect()
  return (
    <button
      type="button"
      className="inspect-toggle"
      aria-pressed={on}
      onClick={() => setEnabled(!on)}
    >
      {on ? 'Hide how this page is built' : 'How is this page built?'}
    </button>
  )
}

// --- what the browser saw ----------------------------------------------------

type Arrival = 'html' | 'streamed' | 'browser'
type Records = {
  seen: WeakMap<Element, Arrival>
  times: WeakMap<Element, number>
  browserOnly: WeakSet<Element>
  streamedInto: WeakSet<Element>
}

function records(): Records | undefined {
  return (window as unknown as Record<symbol, Records | undefined>)[
    Symbol.for('example-inspect.arrivals')
  ]
}

// Island hydration times, from the library's bubbling `nf:island` DOM event
// (registered when this module loads, before islands hydrate).
const hydratedIn = new WeakMap<Element, number>()
if (typeof document !== 'undefined') {
  document.addEventListener('nf:island', (event) => {
    const detail = (event as CustomEvent<{ type: string; ms?: number }>).detail
    const wrapper = (event.target as Element | null)?.closest?.('.embedded')
    if (detail?.type === 'island:hydrate' && wrapper) {
      hydratedIn.set(wrapper, Math.round(detail.ms ?? 0))
    }
  })
}

type Observed = {
  arrival: Arrival | 'unknown'
  /** Some of its markup streamed after the first HTML. */
  partlyStreamed: boolean
  at?: number
  browserOnly: boolean
  /** The island container is there (not a fallback). */
  rendered: boolean
  buildId?: string
  state?: string
  hydrateMs?: number
  parts: string[]
}

function observe(wrapper: Element, info: EmbedInfo): Observed {
  const rec = records()
  const body = wrapper.querySelector(':scope > .embedded-body')
  const root = body?.querySelector<HTMLElement>('[data-nf-root]') ?? null
  const content =
    info.kind === 'island'
      ? root
      : (body?.querySelector('[data-embed-content]') ??
        body?.firstElementChild ??
        null)
  const arrival: Observed['arrival'] = rec?.streamedInto.has(wrapper)
    ? 'streamed'
    : (content && rec?.seen.get(content)) || 'unknown'
  let partlyStreamed = false
  const parts: string[] = []
  for (const el of body?.querySelectorAll('*') ?? []) {
    if (rec?.seen.get(el) === 'streamed') partlyStreamed = true
    const part = el.getAttribute('data-part')
    const ds = el.getAttribute('data-ds')
    if (part) parts.push(part)
    if (ds) {
      const copy = el.getAttribute('data-ds-copy')
      parts.push(
        `design-system ${ds} (${copy === 'host' ? "the host's copy" : "the remote's bundled fallback copy"})`
      )
    }
  }
  return {
    arrival,
    partlyStreamed,
    at: content ? rec?.times.get(content) : undefined,
    browserOnly: rec?.browserOnly.has(wrapper) ?? false,
    rendered: info.kind !== 'island' || root !== null,
    buildId: root?.dataset.nfBuild ?? info.buildId,
    state: root?.dataset.nfState,
    hydrateMs: hydratedIn.get(wrapper),
    parts: [...new Set(parts)],
  }
}

// --- the per-piece badge -----------------------------------------------------

const CONFIGURED: Record<EmbedInfo['cache'], string> = {
  static: 'static: prerendered into the page shell, refreshed by tag',
  streamed: 'streamed: its own Suspense boundary, rendered per request',
  blocking: 'blocking: rendered per request, in the first HTML, no fallback',
  'per-request': 'per request (getServerSideProps), in the first HTML',
  browser: 'fetched and rendered in the browser (no host server)',
}

const ARRIVED: Record<Observed['arrival'], string> = {
  html: 'in the first HTML',
  streamed: 'streamed later in the same response',
  browser: 'rendered in the browser after the page loaded',
  unknown: 'not recorded (rendered in the browser)',
}

function where(info: EmbedInfo, seen: Observed): string {
  const remote = info.remote ? REMOTES[info.remote].label : 'host'
  if (info.kind === 'host component') return "Rendered by this host's React"
  if (info.kind === 'island') {
    if (!seen.rendered) {
      return 'Not rendered: the host shows its fallback (remote down, signed out, or refused)'
    }
    const how =
      seen.arrival === 'browser' || info.cache === 'browser'
        ? `Rendered on the ${remote} remote's server; this page inserted its HTML in the browser`
        : `Rendered on the ${remote} remote's server, embedded by this host's server`
    return `${how}, then hydrated as its own React root${seen.state ? ` (now: ${seen.state})` : ''}`
  }
  if (seen.browserOnly) {
    return "Rendered in the browser only: the host's server left it to the browser (an unverified build, or it failed there; the host logs NF-028 or NF-040)"
  }
  if (info.cache === 'browser' || seen.arrival === 'browser') {
    return "Rendered in the browser, on this host's React"
  }
  return "Server-rendered by this host from the remote's verified, signed build, then hydrated on the host's React"
}

function trailOf(info: EmbedInfo, seen: Observed): string[] {
  const remote = info.remote ? ` (${REMOTES[info.remote].label})` : ''
  return [...info.trail, `${info.kind} ${info.name}${remote}`, ...seen.parts]
}

/** The one-line chip: what, from where, rendered where, arrived when. */
function chipOf(info: EmbedInfo, seen: Observed): string {
  const from = info.remote ? REMOTES[info.remote].label : 'host'
  const kind =
    info.kind === 'remote component' ? 'component' : info.kind.split(' ')[0]
  let rendered: string
  if (info.kind === 'host component') rendered = 'host React'
  else if (info.kind === 'island')
    rendered = seen.rendered ? `SSR on ${from} remote` : 'fallback shown'
  else if (seen.browserOnly) rendered = 'browser only'
  else if (info.cache === 'browser' || seen.arrival === 'browser')
    rendered = 'browser'
  else rendered = 'SSR on host (signed)'
  const arrived =
    info.cache === 'browser'
      ? 'client-only'
      : seen.arrival === 'html'
        ? info.cache === 'blocking'
          ? 'blocking, first HTML'
          : 'first HTML'
        : seen.arrival === 'streamed'
          ? 'streamed'
          : 'browser'
  return `${kind} ${info.name} · ${from} · ${rendered} · ${arrived}`
}

export function InspectBadge({ info }: { info: EmbedInfo }) {
  const on = useInspect()
  const anchor = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<Observed | null>(null)
  useEffect(() => {
    if (!on) return
    const update = () => {
      const wrapper = anchor.current?.closest('.embedded')
      if (wrapper) setSeen(observe(wrapper, info))
    }
    update()
    // Islands go from booting to live, actions re-render: refresh a little.
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [on, info])
  const remote = info.remote ? REMOTES[info.remote] : null
  return (
    <span ref={anchor} className="inspect-anchor">
      {on && seen ? (
        <button
          type="button"
          className="inspect-chip"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          ⓘ {chipOf(info, seen)}
        </button>
      ) : null}
      {on && seen && open ? (
        <span className="inspect-badge" role="note">
          <span className="inspect-trail">
            {trailOf(info, seen).map((step, i) => (
              <span key={i} className={`inspect-depth-${Math.min(i, 4)}`}>
                {step}
              </span>
            ))}
          </span>
          <span className="inspect-row">
            <b>What</b> {info.kind} <code>{info.name}</code>
            {remote ? (
              <>
                {' '}
                from the {remote.label} remote ({remote.long}; {remote.tech})
              </>
            ) : null}
          </span>
          <span className="inspect-row">
            <b>Where</b> {where(info, seen)}
          </span>
          <span className="inspect-row">
            <b>Cache</b> configured as {CONFIGURED[info.cache]}
            {info.revalidate
              ? `; revalidate ${info.revalidate} s; tags nf:${info.remote}, nf:${info.remote}:${info.name}`
              : ''}
          </span>
          {info.cache !== 'browser' && (
            <span className="inspect-row">
              <b>Arrived</b> {ARRIVED[seen.arrival]}
              {seen.partlyStreamed && seen.arrival === 'html'
                ? ' (part of it streamed later)'
                : ''}
              {seen.at !== undefined ? ` at ${seen.at} ms` : ''}
              {seen.hydrateMs !== undefined
                ? `; hydrated in ${seen.hydrateMs} ms`
                : ''}
            </span>
          )}
          <span className="inspect-row">
            <b>Router</b> {info.router}
          </span>
          <span className="inspect-row">
            <b>Identity</b>{' '}
            {info.isPrivate
              ? `private: the host signed a short-lived token for the "${info.remote}" audience only (never shown, never in the HTML)`
              : 'public: no user, the same for everyone'}
          </span>
          {seen.buildId && (
            <span className="inspect-row">
              <b>Build</b> <code>{seen.buildId}</code>
            </span>
          )}
          {info.notes?.map((note) => (
            <span key={note} className="inspect-row">
              {note}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  )
}

// --- the page summary ----------------------------------------------------------

const MODES = {
  static: '○ static: the whole page is a prerendered shell',
  partial:
    '◐ partial prerender: a static shell, with per-request parts streamed into it',
  dynamic: 'ƒ dynamic: rendered on every request',
  browser: 'client-only: the browser renders everything (no host server)',
} as const

type Row = { name: string; arrival: string; at?: number; hydrateMs?: number }

export function PagePanel(props: {
  /** How the route is configured in the code (not measured). */
  mode: keyof typeof MODES
  why: string
  router: EmbedInfo['router']
  /** Path of the page's source file in the repository. */
  file: string
  guide: { href: string; label: string }
}) {
  const on = useInspect()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  // Open by default on wide screens; collapsed on phones (it would cover
  // the page).
  useEffect(() => {
    if (on) setOpen(window.matchMedia('(min-width: 720px)').matches)
  }, [on])
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!on) return
    setUrl(location.href)
    const update = () => {
      const rec = records()
      setRows(
        // Visible pieces only: Next keeps earlier routes in the DOM, hidden.
        [...document.querySelectorAll('.embedded')]
          .filter((wrapper) => wrapper.checkVisibility())
          .map((wrapper) => {
            const body = wrapper.querySelector(':scope > .embedded-body')
            const content =
              body?.querySelector('[data-nf-root]') ??
              body?.querySelector('[data-embed-content]') ??
              body?.firstElementChild
            const arrival = rec?.streamedInto.has(wrapper)
              ? 'streamed'
              : (content && rec?.seen.get(content)) || 'unknown'
            return {
              name: wrapper.getAttribute('data-embed') ?? '?',
              arrival: props.mode === 'browser' ? 'browser' : arrival,
              at: content ? rec?.times.get(content) : undefined,
              hydrateMs: hydratedIn.get(wrapper),
            }
          })
      )
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [on, props.mode])
  if (!on) return null
  const source = `https://github.com/tariqule/next-federation/blob/main/${props.file}`
  return (
    <aside className="inspect-panel" aria-label="How this page is built">
      <button
        type="button"
        className="inspect-panel-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? '▾' : '▸'} How this page is built
      </button>
      {open && (
        <div>
          <p>
            <b>Route</b> ({props.router}) configured as {MODES[props.mode]}.{' '}
            {props.why}
          </p>
          <p>
            <b>Timeline</b> server render, then the HTML streams, then the
            browser hydrates:
          </p>
          <ol className="inspect-timeline">
            {rows.map((row, i) => (
              <li key={i}>
                <code>{row.name}</code>:{' '}
                {ARRIVED[row.arrival as Arrival] ?? row.arrival}
                {row.at !== undefined ? ` (${row.at} ms)` : ''}
                {row.hydrateMs !== undefined
                  ? `, hydrated as an island in ${row.hydrateMs} ms`
                  : ''}
              </li>
            ))}
          </ol>
          <p className="inspect-small">
            How it is measured: a small script in the page head watches the HTML
            parser. Pieces inserted in place are in the first HTML; pieces
            inside React&apos;s hidden streaming containers arrived later in the
            same response.
          </p>
          <p className="inspect-small">
            See the server HTML: <code>view-source:{url}</code> (or{' '}
            <code>curl -s {url}</code>). Guide:{' '}
            <a href={props.guide.href}>{props.guide.label}</a>. Source:{' '}
            <a href={source}>{props.file}</a>.
          </p>
        </div>
      )}
    </aside>
  )
}

// --- island events as toasts ----------------------------------------------------

type Toast = { id: number; text: string; bad: boolean }

/**
 * A small activity log from the islands' `nf:island` DOM events (Server
 * Action results and island errors). The events carry no arguments, results
 * or tokens.
 */
export function ActivityToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => {
    let next = 0
    const onEvent = (event: Event) => {
      const d = (event as CustomEvent).detail as {
        type: string
        remote: string
        ok?: boolean
        ms?: number
        code?: string
        status?: number
      }
      const label = REMOTES[d.remote as keyof typeof REMOTES]?.label ?? d.remote
      let toast: Omit<Toast, 'id'> | null = null
      if (d.type === 'island:action') {
        toast = d.ok
          ? { text: `${label}: Server Action done in ${d.ms} ms`, bad: false }
          : {
              text: `${label}: Server Action failed (${d.code ?? d.status})`,
              bad: true,
            }
      } else if (d.type === 'island:error') {
        toast = { text: `${label} island error (${d.code})`, bad: true }
      }
      if (!toast) return
      const id = ++next
      setToasts((list) => [...list.slice(-3), { id, ...toast }])
      setTimeout(
        () => setToasts((list) => list.filter((t) => t.id !== id)),
        5000
      )
    }
    document.addEventListener('nf:island', onEvent)
    return () => document.removeEventListener('nf:island', onEvent)
  }, [])
  return (
    <div className="activity" aria-live="polite">
      {toasts.map((t) => (
        <p key={t.id} className={t.bad ? 'activity-bad' : undefined}>
          {t.text}
        </p>
      ))}
    </div>
  )
}
