// The Mode A React bindings, created over a runtime (index.tsx wires the real
// one; tests pass a fake, with `isServer` set either way).
import type {
  ComponentExposeAssets,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
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
  /** Shown while loading, when the remote is down, and when it failed. */
  fallback?: ReactNode
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
}

export type RemoteComponentType<P> = ((
  props: RemoteComponentProps<P>
) => ReactNode) & {
  /** `preloadRemoteComponent` for this component's expose. */
  preload(descriptor: RemoteComponentDescriptor | null): Promise<void>
}

/** Marks, in the server HTML, a boundary the server left to the browser. */
export const BROWSER_ONLY_ATTR = 'data-nf-browser-only'

type BoundaryProps = { fallback: ReactNode; children: ReactNode }

class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const subscribeNothing = () => () => {}

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
}: {
  runtime: BindingsRuntime
  isServer: boolean
}): Bindings {
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
    const browserOnly = (
      <>
        <template {...{ [BROWSER_ONLY_ATTR]: id }} />
        {fallback}
      </>
    )
    if (marked && !hydrated) return browserOnly
    const mod = use(
      (isServer
        ? runtime.serverLoad(descriptor, expose)
        : runtime.load(descriptor, expose)) as Promise<RemoteModule | null>
    )
    if (!mod) return browserOnly
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
        {createElement(
          mod.default as ComponentType<Record<string, unknown>>,
          props
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
      ...props
    }: RemoteComponentProps<P>): ReactNode {
      const fallback = fallbackProp ?? options.fallback ?? null
      if (!descriptor) return fallback
      if (isServer) preloadAssets(descriptor, expose)
      const tree = (
        <Boundary key={descriptor.base} fallback={fallback}>
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
