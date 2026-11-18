// The Mode A React bindings, created over a runtime (index.tsx wires the real
// one; tests pass a fake, with `isServer` set either way).
import type {
  ComponentExposeAssets,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'
import { NFError, logger } from '@next-federation/sdk'
import {
  Component,
  Suspense,
  createElement,
  use,
  useId,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ComponentType, ReactNode } from 'react'
import { preinit, preload, preloadModule } from 'react-dom'
import type {
  ComponentEvent,
  ComponentRuntime,
  RemoteModule,
  SharedModules,
  Thenable,
} from './runtime.ts'

export type BindingsRuntime = Pick<
  ComponentRuntime,
  'load' | 'serverLoad' | 'serverBlock' | 'registerShared'
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
}

export type RemoteComponentType<P> = ((
  props: RemoteComponentProps<P>
) => ReactNode) & {
  /** `preloadRemoteComponent` for this component's expose. */
  preload(descriptor: RemoteComponentDescriptor | null): Promise<void>
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

function hasBrowserOnlyMark(id: string): boolean {
  if (typeof document === 'undefined') return false
  return (
    document.querySelector(
      `template[${BROWSER_ONLY_ATTR}="${CSS.escape(id)}"]`
    ) !== null
  )
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
  /** Receives `component:error` for a render error (NF-040). */
  emit?: (event: ComponentEvent) => void
}): Bindings {
  // Module load failures the runtime reported itself (thrown by `use`).
  const loadFailures = new WeakSet<object>()
  // Server: each render error is logged once per build, expose and message.
  const loggedOnServer = new Set<string>()
  // One renderer per component type, so its identity (and state) is stable.
  const renderers = new WeakMap<object, ComponentType<RendererProps>>()

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
    try {
      emit?.({
        type: 'component:error',
        remote: descriptor.remote,
        buildId: descriptor.buildId,
        expose,
        code: 'NF-040',
        error,
        env,
      })
    } catch (observerError) {
      logger.debug('component event observer threw', observerError)
    }
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
  async function preloadRemoteComponent(
    descriptor: RemoteComponentDescriptor | null,
    expose: string
  ): Promise<void> {
    if (!descriptor) return
    if (isServer) {
      await runtime.serverLoad(descriptor, expose)
      return
    }
    await runtime.load(descriptor, expose).then(
      () => undefined,
      () => undefined
    )
  }

  function Loaded({
    descriptor,
    expose,
    props,
    fallback,
  }: {
    descriptor: RemoteComponentDescriptor
    expose: string
    props: Record<string, unknown>
    fallback: ReactNode
  }): ReactNode {
    // The same hooks on both sides, so ids below match during hydration.
    const id = useId()
    // Hydrating a boundary the server left to the browser: render exactly
    // what the server sent (a mark and the fallback), then load. No error,
    // no hydration mismatch.
    const [marked] = useState(() => !isServer && hasBrowserOnlyMark(id))
    const hydrated = useSyncExternalStore(
      subscribeNothing,
      () => true,
      () => false
    )
    // True when this boundary first renders in the browser after hydration,
    // or is one the server left to the browser (it sent no stylesheet).
    const [clientMount] = useState(hydrated || marked)
    const files = exposeAssets(descriptor, expose)
    const css = files?.css ?? []
    if (clientMount) {
      // Before the load below starts (see CSS_PRECEDENCE).
      for (const href of css) {
        preinit(href, { as: 'style', precedence: CSS_PRECEDENCE })
      }
    }
    const markAndFallback = (
      <>
        <template {...{ [BROWSER_ONLY_ATTR]: id }} />
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
    if (marked && !hydrated) return browserOnly
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
    const mod = use(loading as Promise<RemoteModule | null>)
    if (!mod) return browserOnly
    const Render = renderer(mod.default, isServer, renderers)
    return (
      <>
        {clientMount
          ? null
          : css.map((href) => (
              <link
                key={href}
                rel="stylesheet"
                href={href}
                precedence={CSS_PRECEDENCE}
              />
            ))}
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
   * Server render of a build this server renders: modulepreload the remote
   * entry and the expose's chunks, and preload its stylesheets, from the
   * shell (outside Suspense), so the browser fetches them in parallel
   * instead of manifest, then entry, then chunks.
   */
  function preloadAssets(
    descriptor: RemoteComponentDescriptor,
    expose: string
  ): void {
    if (!descriptor.ssr || runtime.serverBlock(descriptor)) return
    const files = exposeAssets(descriptor, expose)
    if (!files) return
    for (const href of files.css) preload(href, { as: 'style' })
    if (files.entry) preloadModule(files.entry)
    for (const href of files.js) preloadModule(href)
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
      ...props
    }: RemoteComponentProps<P>): ReactNode {
      const fallback = fallbackProp ?? options.fallback ?? null
      const errorFallback =
        errorFallbackProp ?? options.errorFallback ?? fallback
      if (!descriptor) return errorFallback
      if (isServer) preloadAssets(descriptor, expose)
      const onError = (error: unknown) => {
        if (typeof error === 'object' && error !== null) {
          if (loadFailures.has(error)) return
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
            />
          </Suspense>
        </Boundary>
      )
      // An unverified build has no server rendering: render it after hydration.
      return descriptor.ssr ? (
        tree
      ) : (
        <BrowserOnly fallback={fallback}>{tree}</BrowserOnly>
      )
    }
    RemoteComponent.displayName = `RemoteComponent(${expose})`
    RemoteComponent.preload = (descriptor: RemoteComponentDescriptor | null) =>
      preloadRemoteComponent(descriptor, expose)
    return RemoteComponent
  }

  return { loadRemoteModule, preloadRemoteComponent, createRemoteComponent }
}
