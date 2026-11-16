// The Mode A React bindings, created over a runtime (index.tsx wires the real
// one; tests pass a fake, with `isServer` set either way).
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
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
   * them in its `shared` (host-provided, never bundled).
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
    return createElement(
      mod.default as ComponentType<Record<string, unknown>>,
      props
    )
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
