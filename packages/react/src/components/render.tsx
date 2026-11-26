// The remote components React bindings, created over a runtime (index.tsx wires
// the real one; tests pass a fake, with `isServer` set either way).
import type {
  ComponentExposeAssets,
  ComponentRefusalCode,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'
import { NFError, isNFError, logger } from '@next-federation/sdk'
import type { NFErrorCode } from '@next-federation/sdk'
import {
  Component,
  Suspense,
  createElement,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ComponentType, ReactNode } from 'react'
import {
  ensureStylesheet,
  preloadModuleScript,
  preloadStyle,
  readThenable,
  supportsResources,
  useIsomorphicLayoutEffect,
} from '../react-compat.ts'
import type {
  ComponentEvent,
  ComponentFallbackEvent,
  ComponentRuntime,
  RemoteModule,
  SharedModules,
  Thenable,
} from './runtime.ts'
import { classifyClientError, classifyOutcome } from './preload-result.ts'
import type { PreloadOptions, PreloadResult } from './preload-result.ts'

export type BindingsRuntime = Pick<
  ComponentRuntime,
  | 'load'
  | 'serverLoad'
  | 'serverBlock'
  | 'serverOutcome'
  | 'registerShared'
  | 'refuse'
  | 'refusedBuild'
>

export type RemoteComponentOptions = {
  /** The exposed module, e.g. './Counter' (its default export renders). */
  expose: string
  /**
   * Shown while the component loads (and in the server HTML of a component
   * the browser renders). Also on failure, unless `errorFallback` is set.
   */
  fallback?: ReactNode
  /**
   * Shown when the component failed: the remote could not be reached
   * (`descriptor` is null), its module could not load, or it threw while
   * rendering. Default: `fallback`.
   */
  errorFallback?: ReactNode
  /**
   * Modules this host provides to remotes, besides React: the remote lists
   * them in its `shared`. `version` is the real version of the host's copy
   * (from its package.json): a remote whose `requiredVersion` it does not
   * satisfy renders its fallback (NF-036), unless the remote bundles its own
   * copy (`fallback: true`).
   */
  shared?: SharedModules
}

export type RemoteComponentProps<P> = P & {
  /**
   * From `getComponentDescriptor` (server) or `fetchDescriptorInBrowser`
   * (SPA) only; null renders the fallback. A server evaluates remote code
   * only for a descriptor it verified itself.
   */
  descriptor: RemoteComponentDescriptor | null
  fallback?: ReactNode
  errorFallback?: ReactNode
  /**
   * Render this component in the browser only on this response: the server
   * sends the fallback and a mark and never loads the remote's server build.
   * A refusal the server already knows (NF-027, NF-036) still wins. Not
   * passed to the remote component.
   */
  browserOnly?: boolean
}

export type RemoteComponentType<P> = ((
  props: RemoteComponentProps<P>
) => ReactNode) & {
  /** `preloadRemoteComponent` for this component's expose. */
  preload(descriptor: RemoteComponentDescriptor | null): Promise<void>
  /** With options: waits at most `timeoutMs` and says how the load settled. */
  preload(
    descriptor: RemoteComponentDescriptor | null,
    options: PreloadOptions
  ): Promise<PreloadResult>
  preload(
    descriptor: RemoteComponentDescriptor | null,
    options?: PreloadOptions
  ): Promise<void | PreloadResult>
}

declare global {
  /**
   * The type declarations of remote components: remote -> expose -> module
   * type. Empty until `nf-types` (@next-federation/next) writes
   * `next-federation-types/index.d.ts`, which fills it from each remote
   * build's signed declarations.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface NextFederationRemoteComponents {}
}

/**
 * The props of an exposed remote component, from the declarations `nf-types`
 * downloaded: `createRemoteComponent<RemoteProps<'components', './Counter'>>`.
 * Type-only: the host never imports the remote's code to get them.
 */
export type RemoteProps<
  R extends keyof NextFederationRemoteComponents,
  E extends keyof NextFederationRemoteComponents[R],
> = NextFederationRemoteComponents[R][E] extends { default: infer C }
  ? C extends (props: infer P) => unknown
    ? P
    : C extends new (props: infer P) => unknown
      ? P
      : never
  : never

/** Marks, in the server HTML, a boundary the server left to the browser. */
export const BROWSER_ONLY_ATTR = 'data-nf-browser-only'

/**
 * Marks, in the server HTML, a boundary whose build the server refused (an
 * integrity failure, code from other remotes): the browser keeps the error
 * fallback and never loads that build.
 */
export const REFUSED_ATTR = 'data-nf-refused'

type BoundaryProps = { fallback: ReactNode; children: ReactNode }

/**
 * Browser only: React error boundaries do not run on the server (a server
 * render error is caught where the remote component renders, see
 * `renderer`). Reports what it caught through `onError`.
 */
class Boundary extends Component<
  BoundaryProps & { onError: (error: unknown) => void },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(error: unknown): void {
    this.props.onError(error)
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * Thrown values a server render must never catch: React's own suspension
 * (`use`, a thrown thenable, postpone) and a framework's control-flow errors,
 * which carry a string `digest` (a client-rendering bailout, a redirect).
 */
function isControlFlow(thrown: unknown): boolean {
  if (typeof thrown !== 'object' || thrown === null) return false
  const value = thrown as {
    then?: unknown
    digest?: unknown
    message?: unknown
    $$typeof?: unknown
  }
  // React's `use()` throws an Error named only by this message prefix
  // ("Suspense Exception: This is not a real error!"). Re-verify it on every
  // React upgrade (components-render-errors.spec.tsx pins it).
  return (
    typeof value.then === 'function' ||
    typeof value.digest === 'string' ||
    value.$$typeof === Symbol.for('react.postpone') ||
    (typeof value.message === 'string' &&
      value.message.startsWith('Suspense Exception:'))
  )
}

type RendererProps = {
  props: Record<string, unknown>
  /** Server: renders instead of the component when its render threw. */
  onServerError: (error: unknown) => ReactNode
}

/**
 * Renders a remote module's default export. A plain function component is
 * called by this renderer itself (the same on both sides, so hooks and ids
 * match during hydration), which lets a server render catch an error from
 * the component's own render: React has no error boundaries on the server,
 * and a framework may fail a whole prerender on such an error. Class, memo
 * and forwardRef components render as elements.
 */
function renderer(
  type: unknown,
  isServer: boolean,
  renderers: WeakMap<object, ComponentType<RendererProps>>
): ComponentType<RendererProps> | null {
  if (typeof type !== 'function') return null
  if (
    (type as { prototype?: { isReactComponent?: unknown } }).prototype
      ?.isReactComponent
  ) {
    return null
  }
  const known = renderers.get(type)
  if (known) return known
  const render = type as (props: Record<string, unknown>) => ReactNode
  const Render = ({ props, onServerError }: RendererProps): ReactNode => {
    if (!isServer) return render(props)
    try {
      return render(props)
    } catch (error) {
      if (isControlFlow(error)) throw error
      return onServerError(error)
    }
  }
  const named = type as { displayName?: unknown; name?: unknown }
  Render.displayName = String(named.displayName || named.name || 'Remote')
  renderers.set(type, Render)
  return Render
}

const subscribeNothing = () => () => {}

/** Renders its children: stands where the renderer would, to keep the tree shape. */
function Slot({ children }: { children: ReactNode }): ReactNode {
  return children
}

/** Fallback on the server and during hydration; children once hydrated. */
function BrowserOnly({ fallback, children }: BoundaryProps): ReactNode {
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  )
  return hydrated ? children : fallback
}

/** Carries, on a marker, the build base it is for: others are ignored. */
const MARK_BASE_ATTR = 'data-nf-base'
/** Carries, on a refused marker, why the server refused the build. */
const MARK_CODE_ATTR = 'data-nf-code'
const REFUSAL_CODES: readonly string[] = ['NF-027', 'NF-028', 'NF-036']

/** The server marker of this boundary (id) for this build (base), if any. */
function findMark(attr: string, id: string, base: string): Element | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(
    `template[${attr}="${CSS.escape(id)}"][${MARK_BASE_ATTR}="${CSS.escape(base)}"]`
  )
}

function hasBrowserOnlyMark(id: string, base: string): boolean {
  return findMark(BROWSER_ONLY_ATTR, id, base) !== null
}

function refusedMarkCode(
  id: string,
  base: string
): ComponentRefusalCode | undefined {
  const code = findMark(REFUSED_ATTR, id, base)?.getAttribute(MARK_CODE_ATTR)
  return code && REFUSAL_CODES.includes(code)
    ? (code as ComponentRefusalCode)
    : undefined
}

/**
 * Remote component stylesheets are React 19 stylesheet resources, as for
 * islands (island-mount.tsx): one link per href across the page, in `<head>`
 * in this precedence group. A server-rendered component renders
 * `<link precedence>` next to its markup, so its HTML never paints unstyled
 * (a streamed boundary is revealed once its stylesheet loaded); hydration
 * renders the same links. A component first mounted in the browser (client
 * navigation, browser-only build, SPA) inserts them with `preinit` instead:
 * a rendered one would hold the commit (the host's navigation) until it
 * loads. Either way the stylesheet is in the document before the module
 * loads, so the remote's own CSS loader finds it and never adds another.
 *
 * React 18 has no stylesheet resources (react-compat.ts). There a client
 * mount appends a `<link data-precedence>` to the end of `<head>` (once per
 * href, never removed); server HTML carries an inline `<link
 * data-precedence>` ahead of the component markup, and hydration adds the
 * same head copy, so the styles stay when the inline link leaves with its
 * component (a client navigation) while another instance still uses them.
 */
const CSS_PRECEDENCE = 'next-federation'

/** The descriptor's browser files of one expose, only URLs under its base. */
function exposeAssets(
  descriptor: RemoteComponentDescriptor,
  expose: string
): (ComponentExposeAssets & { entry: string | null }) | null {
  const assets = descriptor.assets
  const files = assets?.exposes[expose]
  if (!assets || !files) return null
  const inside = (url: string) => url.startsWith(descriptor.base)
  return {
    entry: inside(assets.entry) ? assets.entry : null,
    css: [...new Set(files.css.filter(inside))],
    js: [...new Set(files.js.filter(inside))],
  }
}

export type Bindings = {
  loadRemoteModule(
    descriptor: RemoteComponentDescriptor,
    expose: string
  ): Thenable<RemoteModule>
  preloadRemoteComponent(
    descriptor: RemoteComponentDescriptor | null,
    expose: string
  ): Promise<void>
  preloadRemoteComponent(
    descriptor: RemoteComponentDescriptor | null,
    expose: string,
    options: PreloadOptions
  ): Promise<PreloadResult>
  preloadRemoteComponent(
    descriptor: RemoteComponentDescriptor | null,
    expose: string,
    options?: PreloadOptions
  ): Promise<void | PreloadResult>
  createRemoteComponent<P extends object = Record<string, unknown>>(
    options: RemoteComponentOptions
  ): RemoteComponentType<P>
}

export function createBindings({
  runtime,
  isServer,
  emit,
}: {
  runtime: BindingsRuntime
  isServer: boolean
  /**
   * Receives `component:error` for a render error (NF-040) or a refusal no
   * load reported, and `component:fallback` for each degraded render.
   */
  emit?: (event: ComponentEvent, descriptor: RemoteComponentDescriptor) => void
}): Bindings {
  // Module load failures the runtime reported itself (thrown by `use`).
  const loadFailures = new WeakSet<object>()
  // Server: each render error is logged once per build, expose and message.
  const loggedOnServer = new Set<string>()
  // One renderer per component type, so its identity (and state) is stable.
  const renderers = new WeakMap<object, ComponentType<RendererProps>>()

  function send(
    event: ComponentEvent,
    descriptor: RemoteComponentDescriptor
  ): void {
    try {
      emit?.(event, descriptor)
    } catch (observerError) {
      logger.debug('component event observer threw', observerError)
    }
  }

  /**
   * `component:fallback`: a degraded tree renders in place of the component.
   * Never for the loading placeholder of a pending load.
   */
  function reportFallback(
    descriptor: RemoteComponentDescriptor,
    expose: string,
    reason: ComponentFallbackEvent['reason'],
    code?: NFErrorCode
  ): void {
    send(
      {
        type: 'component:fallback',
        remote: descriptor.remote,
        buildId: descriptor.buildId,
        expose,
        env: isServer ? 'server' : 'client',
        phase: 'render',
        reason,
        ...(code ? { code } : {}),
      },
      descriptor
    )
  }

  /** A refusal no load reported (refused before any load), then its fallback. */
  function reportRefused(
    descriptor: RemoteComponentDescriptor,
    expose: string,
    code: ComponentRefusalCode,
    error: boolean
  ): void {
    if (error) {
      send(
        {
          type: 'component:error',
          remote: descriptor.remote,
          buildId: descriptor.buildId,
          expose,
          code,
          error: new NFError(
            code,
            `Build ${descriptor.buildId} of ${descriptor.remote} is refused (${code}); it is not loaded.`
          ),
          env: isServer ? 'server' : 'client',
          phase: 'render',
          outcome: 'refused',
          // Refused before any load: no time spent.
          ms: 0,
        },
        descriptor
      )
    }
    reportFallback(descriptor, expose, 'refused', code)
  }

  /** NF-040 for an error a remote component threw while rendering. */
  function reportRenderError(
    descriptor: RemoteComponentDescriptor,
    expose: string,
    error: unknown
  ): void {
    const env = isServer ? 'server' : 'client'
    const what = `Remote component ${descriptor.remote}:${expose} (build ${descriptor.buildId}) threw while rendering`
    if (isServer) {
      const message = error instanceof Error ? error.message : String(error)
      const key = `${descriptor.base} ${expose} ${message}`
      if (!loggedOnServer.has(key)) {
        // Bounded: messages may carry ids, and a server runs for long.
        if (loggedOnServer.size >= 1000) loggedOnServer.clear()
        loggedOnServer.add(key)
        logger.error(
          'NF-040',
          `${what} on the server; the page keeps its fallback and the browser renders the component.`,
          error
        )
      }
    } else {
      logger.error(
        'NF-040',
        `${what} in the browser; rendering its error fallback.`,
        error
      )
    }
    send(
      {
        type: 'component:error',
        remote: descriptor.remote,
        buildId: descriptor.buildId,
        expose,
        code: 'NF-040',
        error,
        env,
        phase: 'render',
        outcome: 'fallback',
        // A render error, reported when caught: no load time involved.
        ms: 0,
      },
      descriptor
    )
    reportFallback(descriptor, expose, 'render-error', 'NF-040')
  }

  /**
   * Loads an exposed module of one remote build (cached per build). On the
   * server it is evaluated only for a descriptor verified in this process.
   */
  function loadRemoteModule(
    descriptor: RemoteComponentDescriptor,
    expose: string
  ): Thenable<RemoteModule> {
    if (isServer) {
      const block = runtime.serverBlock(descriptor)
      if (block) {
        const reason = new NFError(
          'NF-028',
          `Remote component ${descriptor.remote}:${expose} (build ${descriptor.buildId}) is not rendered on the server (${block}); the browser renders it.`
        )
        const p = Promise.reject(reason) as Thenable<RemoteModule>
        p.status = 'rejected'
        p.reason = reason
        p.catch(() => {})
        return p
      }
    }
    return runtime.load(descriptor, expose)
  }

  /**
   * Starts loading a remote component's module ahead of rendering, for
   * example in `getServerSideProps`. Never rejects.
   */
  function preloadRemoteComponent(
    descriptor: RemoteComponentDescriptor | null,
    expose: string
  ): Promise<void>
  function preloadRemoteComponent(
    descriptor: RemoteComponentDescriptor | null,
    expose: string,
    options: PreloadOptions
  ): Promise<PreloadResult>
  function preloadRemoteComponent(
    descriptor: RemoteComponentDescriptor | null,
    expose: string,
    options?: PreloadOptions
  ): Promise<void | PreloadResult>
  function preloadRemoteComponent(
    descriptor: RemoteComponentDescriptor | null,
    expose: string,
    options?: PreloadOptions
  ): Promise<void | PreloadResult> {
    return options
      ? preloadWithResult(descriptor, expose, options.timeoutMs)
      : preloadOnly(descriptor, expose)
  }

  /** A promise of `run()`: a synchronous throw becomes a rejection. */
  function attempt<T>(run: () => T | PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve) => resolve(run()))
  }

  /**
   * Races the load against `timeoutMs`. A timeout never cancels the load: it
   * keeps running for later renders and preloads. A NaN or negative
   * `timeoutMs` counts as 0; `Infinity` sets no timer and waits for the load
   * to settle (the runtime's own load timeout still bounds it).
   */
  async function preloadWithResult(
    descriptor: RemoteComponentDescriptor | null,
    expose: string,
    timeoutMs: number
  ): Promise<PreloadResult> {
    const start = Date.now()
    const ms = () => Math.max(0, Date.now() - start)
    if (!descriptor) return { state: 'no-descriptor', ms: ms() }
    const id = {
      remote: descriptor.remote,
      buildId: descriptor.buildId,
      expose,
    }
    // Settles to how the load went; never rejects, so a load that settles
    // after a timeout leaves no unhandled rejection.
    const codeOf = (error: unknown) =>
      isNFError(error) ? error.code : 'NF-029'
    const clientOutcome = (error: unknown) => ({
      ...classifyClientError(error, runtime.refusedBuild(descriptor)),
      ...id,
    })
    const settled: Promise<Omit<PreloadResult, 'ms'>> = isServer
      ? attempt(() => runtime.serverLoad(descriptor, expose)).then(
          () => {
            const outcome = runtime.serverOutcome(descriptor, expose)
            const { state, code } = outcome
              ? classifyOutcome(outcome)
              : { state: 'failed' as const, code: 'NF-029' as const }
            return code ? { state, code, ...id } : { state: 'ready', ...id }
          },
          (error: unknown) => ({ state: 'failed', code: codeOf(error), ...id })
        )
      : attempt(() => runtime.load(descriptor, expose)).then(
          () => ({ state: 'ready', ...id }),
          clientOutcome
        )
    let timer: ReturnType<typeof setTimeout> | undefined
    const bound = Number.isNaN(timeoutMs) ? 0 : Math.max(0, timeoutMs)
    const timedOut = new Promise<Omit<PreloadResult, 'ms'>>((resolve) => {
      if (bound === Number.POSITIVE_INFINITY) return
      timer = setTimeout(() => resolve({ state: 'timeout', ...id }), bound)
    })
    try {
      const result = await Promise.race([settled, timedOut])
      return { ...result, ms: ms() } as PreloadResult
    } finally {
      clearTimeout(timer)
    }
  }

  async function preloadOnly(
    descriptor: RemoteComponentDescriptor | null,
    expose: string
  ): Promise<void> {
    if (!descriptor) return
    await attempt(() =>
      isServer
        ? runtime.serverLoad(descriptor, expose)
        : runtime.load(descriptor, expose)
    ).then(
      () => undefined,
      () => undefined
    )
  }

  function Loaded({
    descriptor,
    expose,
    props,
    fallback,
    errorFallback,
    skipServer,
  }: {
    descriptor: RemoteComponentDescriptor
    expose: string
    props: Record<string, unknown>
    fallback: ReactNode
    errorFallback: ReactNode
    /** The `browserOnly` prop: the server leaves this boundary to the browser. */
    skipServer: boolean
  }): ReactNode {
    // The same hooks on both sides, so ids below match during hydration.
    const id = useId()
    // Hydrating a boundary the server left to the browser: render exactly
    // what the server sent (a mark and the fallback), then load. No error,
    // no hydration mismatch.
    const base = descriptor.base
    const [marked] = useState(() => !isServer && hasBrowserOnlyMark(id, base))
    // Hydrating a boundary the server refused: keep its error fallback for
    // good. A build fact (NF-027/NF-028) is recorded for the build, so no
    // boundary of this page loads it until the refusal expires; NF-036 is
    // per expose and blocks this boundary only (runtime.refuse ignores it).
    const [refusedMark] = useState(() => {
      if (isServer) return undefined
      const code = refusedMarkCode(id, base)
      if (code) runtime.refuse(descriptor, code)
      return code
    })
    // Refused: browser, by the server's marker, the descriptor, or an earlier
    // build-fact marker on this page; server, by descriptor.refused or this layer's
    // recorded outcome (an earlier refused load).
    const refusedCode = refusedMark ?? runtime.refusedBuild(descriptor)
    // Browser: a refused tree is reported once it is shown (effects only run
    // for a committed tree). The server reports it where it renders it.
    useEffect(() => {
      if (!isServer && refusedCode) {
        reportRefused(descriptor, expose, refusedCode, true)
      }
    }, [refusedCode, base, expose])
    const hydrated = useSyncExternalStore(
      subscribeNothing,
      () => true,
      () => false
    )
    // True when this boundary first renders in the browser after hydration,
    // or is one the server left to the browser (it sent no stylesheet).
    const [clientMount] = useState(hydrated || marked)
    const files = exposeAssets(descriptor, expose)
    const css = refusedCode ? [] : (files?.css ?? [])
    if (clientMount) {
      // Before the load below starts (see CSS_PRECEDENCE).
      for (const href of css) ensureStylesheet(href)
    }
    const cssKey = css.join('\n')
    // React 18, server-rendered or hydrated boundary: the head copy of its
    // inline links (it stays after this boundary unmounts).
    useIsomorphicLayoutEffect(() => {
      if (clientMount || supportsResources()) return
      for (const href of css) ensureStylesheet(href)
    }, [clientMount, cssKey])
    const markAndFallback = (
      <>
        <template {...{ [BROWSER_ONLY_ATTR]: id, [MARK_BASE_ATTR]: base }} />
        {fallback}
      </>
    )
    // The same tree shape as a server render error, where the renderer (the
    // second child below) returns `markAndFallback`: ids in the fallback
    // (useId) then match during hydration.
    const browserOnly = (
      <>
        {null}
        <Slot>{markAndFallback}</Slot>
      </>
    )
    // The same shape again, so ids in the error fallback match too.
    const refused = (code: ComponentRefusalCode) => (
      <>
        {null}
        <Slot>
          <template
            {...{
              [REFUSED_ATTR]: id,
              [MARK_BASE_ATTR]: base,
              [MARK_CODE_ATTR]: code,
            }}
          />
          {errorFallback}
        </Slot>
      </>
    )
    /**
     * Server: the refused or browser-only tree for a recorded outcome, and
     * its events. A load error was already reported by the runtime; a
     * refusal the loader blocked (no load ran) is reported here.
     */
    const serverDegraded = (): ReactNode => {
      const outcome = runtime.serverOutcome(descriptor, expose)
      const settled = outcome ? classifyOutcome(outcome) : undefined
      if (settled?.state === 'refused') {
        const { code } = settled
        reportRefused(descriptor, expose, code, outcome?.kind === 'blocked')
        return refused(code)
      }
      reportFallback(
        descriptor,
        expose,
        settled?.state === 'failed' ? 'failed' : 'browser-only',
        settled?.code
      )
      return browserOnly
    }
    if (refusedCode) {
      // Reported as an error only for a descriptor-level refusal (no load
      // ran); any other recorded code gets the fallback event alone.
      if (isServer) {
        reportRefused(
          descriptor,
          expose,
          refusedCode,
          descriptor.refused?.code === refusedCode
        )
      }
      return refused(refusedCode)
    }
    if (marked && !hydrated) return browserOnly
    // A refusal recorded by an earlier load still wins; no load starts.
    if (isServer && skipServer) return serverDegraded()
    const loading = (
      isServer
        ? runtime.serverLoad(descriptor, expose)
        : runtime.load(descriptor, expose)
    ) as Thenable<RemoteModule | null>
    // The runtime logged and reported a failed load: the boundary only
    // renders its fallback for it.
    if (
      loading.status === 'rejected' &&
      typeof loading.reason === 'object' &&
      loading.reason !== null
    ) {
      loadFailures.add(loading.reason)
    }
    const mod = readThenable(loading)
    if (!mod) return serverDegraded()
    // Hints only for a build this server loaded (never pending or refused
    // ones). React hoists them out of the boundary.
    if (isServer) preloadAssets(descriptor, expose)
    const Render = renderer(mod.default, isServer, renderers)
    return (
      <>
        {clientMount
          ? null
          : css.map((href) =>
              supportsResources() ? (
                <link
                  key={href}
                  rel="stylesheet"
                  href={href}
                  precedence={CSS_PRECEDENCE}
                />
              ) : (
                <link
                  key={href}
                  rel="stylesheet"
                  href={href}
                  data-precedence={CSS_PRECEDENCE}
                />
              )
            )}
        {Render ? (
          <Render
            props={props}
            onServerError={(error) => {
              reportRenderError(descriptor, expose, error)
              return markAndFallback
            }}
          />
        ) : (
          createElement(
            mod.default as ComponentType<Record<string, unknown>>,
            props
          )
        )}
      </>
    )
  }

  /**
   * Server render of a build this server loaded: modulepreload the remote
   * entry and the expose's chunks, and preload its stylesheets (React hoists
   * them to the head, or to the boundary's streamed chunk), so the browser
   * fetches them in parallel instead of manifest, then entry, then chunks.
   * Never for a build still loading or refused.
   */
  function preloadAssets(
    descriptor: RemoteComponentDescriptor,
    expose: string
  ): void {
    if (!descriptor.ssr || runtime.serverBlock(descriptor)) return
    const files = exposeAssets(descriptor, expose)
    if (!files) return
    for (const href of files.css) preloadStyle(href)
    if (files.entry) preloadModuleScript(files.entry)
    for (const href of files.js) preloadModuleScript(href)
  }

  /**
   * Binds an exposed client component of a components remote. Call it in a
   * `'use client'` module of the host. The returned component takes the
   * descriptor (which build to render, resolved on the server so the browser
   * loads exactly the build the server rendered) and the remote's own props.
   */
  function createRemoteComponent<P extends object = Record<string, unknown>>(
    options: RemoteComponentOptions
  ): RemoteComponentType<P> {
    if (options.shared) runtime.registerShared(options.shared)
    const { expose } = options
    function RemoteComponent({
      descriptor,
      fallback: fallbackProp,
      errorFallback: errorFallbackProp,
      browserOnly: browserOnlyProp,
      ...props
    }: RemoteComponentProps<P>): ReactNode {
      const fallback = fallbackProp ?? options.fallback ?? null
      const errorFallback =
        errorFallbackProp ?? options.errorFallback ?? fallback
      if (!descriptor) return errorFallback
      const onError = (error: unknown) => {
        if (typeof error === 'object' && error !== null) {
          // The runtime reported the load error; the fallback is ours.
          if (loadFailures.has(error)) {
            const { state, code } = classifyClientError(
              error,
              runtime.refusedBuild(descriptor)
            )
            reportFallback(descriptor, expose, state, code)
            return
          }
        }
        reportRenderError(descriptor, expose, error)
      }
      const tree = (
        <Boundary
          key={descriptor.base}
          fallback={errorFallback}
          onError={onError}
        >
          <Suspense fallback={fallback}>
            <Loaded
              descriptor={descriptor}
              expose={expose}
              props={props as Record<string, unknown>}
              fallback={fallback}
              errorFallback={errorFallback}
              skipServer={browserOnlyProp === true}
            />
          </Suspense>
        </Boundary>
      )
      // An unverified build has no server rendering: render it after hydration.
      if (isServer && !descriptor.ssr) {
        const code = descriptor.refused?.code
        if (code) reportRefused(descriptor, expose, code, true)
        else reportFallback(descriptor, expose, 'browser-only')
      }
      return descriptor.ssr ? (
        tree
      ) : (
        <BrowserOnly fallback={fallback}>{tree}</BrowserOnly>
      )
    }
    RemoteComponent.displayName = `RemoteComponent(${expose})`
    RemoteComponent.preload = ((
      descriptor: RemoteComponentDescriptor | null,
      options?: PreloadOptions
    ) =>
      preloadRemoteComponent(
        descriptor,
        expose,
        options
      )) as RemoteComponentType<P>['preload']
    return RemoteComponent
  }

  return { loadRemoteModule, preloadRemoteComponent, createRemoteComponent }
}
