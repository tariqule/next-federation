'use client'
// Remote components: Module Federation client components rendered inside the
// host's React tree. One module for both environments: Next compiles it in the
// SSR layer on the server and in the browser layer on the client, so the React
// it imports is the React that renders it in each environment, and that React
// is what remotes get (they are built with React as host-provided).
import * as MFRuntime from '@module-federation/runtime'
import { createInstance } from '@module-federation/runtime'
import { parseComponentDescriptorFile } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { navigationModule } from '@next-federation/router/host-navigation'
import type { NavigationHooks } from '@next-federation/router/host-navigation'
import { serverLoader } from '@next-federation/react/components/server-loader'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JsxRuntime from 'react/jsx-runtime'
import { createBindings } from './render.tsx'
export type {
  PreloadOptions,
  PreloadResult,
  PreloadState,
} from './preload-result.ts'
import type { Bindings } from './render.tsx'
import { createComponentRuntime } from './runtime.ts'
import { serverComponentEmit } from './server-events.ts'
import type {
  ComponentEvent,
  FederationInstance,
  RemoteModule,
  SharedModules,
} from './runtime.ts'

export type { RemoteComponentDescriptor }
export type { ComponentEvent, RemoteModule, SharedModules }
export type { NavigationHooks }
export type {
  RemoteComponentOptions,
  RemoteComponentProps,
  RemoteComponentType,
  RemoteProps,
} from './render.tsx'

/** Name of the DOM event (on `document`) for every remote component load and failure. */
export const COMPONENT_EVENT = 'nf:component'

const isServer = typeof window === 'undefined'

function emit(
  event: ComponentEvent,
  descriptor: RemoteComponentDescriptor
): void {
  // Server: to the onEvent of the federation that resolved the descriptor.
  if (typeof document === 'undefined') {
    serverComponentEmit(event, descriptor)
    return
  }
  document.dispatchEvent(new CustomEvent(COMPONENT_EVENT, { detail: event }))
}

const runtime = createComponentRuntime({
  isServer,
  react: React,
  hostShared: {
    react: { version: React.version, module: React },
    'react/jsx-runtime': { version: React.version, module: JsxRuntime },
    'react-dom': { version: ReactDOM.version, module: ReactDOM },
    'react-dom/client': { version: ReactDOM.version, module: ReactDOMClient },
  },
  registerGlobalPlugins: (plugins) =>
    MFRuntime.registerGlobalPlugins(
      plugins as Parameters<typeof MFRuntime.registerGlobalPlugins>[0]
    ),
  createInstance: (options) =>
    createInstance(
      options as unknown as Parameters<typeof createInstance>[0]
    ) as unknown as FederationInstance,
  serverPlugin: serverLoader
    ? (integrityFor, scope) =>
        serverLoader!.createServerEntryPlugin({
          integrityFor,
          hostModules: { '@module-federation/runtime': MFRuntime },
          // This layer's own MF state (a mixed-router host has two).
          scope,
        })
    : undefined,
  forget: serverLoader
    ? (instance, scope) => serverLoader!.forgetInstance(instance, scope)
    : undefined,
  canLoadServerCode: () => serverLoader?.canLoadServerCode() ?? false,
  isTrusted: (descriptor) =>
    serverLoader?.isTrustedDescriptor(descriptor) ?? false,
  // The comments keep host bundlers from resolving or bundling the remote URL.
  importEntry: (url) =>
    import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url
    ),
  emit,
})

const bindings = createBindings({ runtime, isServer, emit })

/**
 * Loads an exposed module of one remote build (cached per build). On the
 * server it is evaluated only for a descriptor verified in this process.
 */
export const loadRemoteModule: Bindings['loadRemoteModule'] =
  bindings.loadRemoteModule

/**
 * Starts loading a remote component's module ahead of rendering, for example
 * in `getServerSideProps`, so the first render after a deploy is inline HTML.
 * Never rejects.
 */
export const preloadRemoteComponent: Bindings['preloadRemoteComponent'] =
  bindings.preloadRemoteComponent

/**
 * Binds an exposed client component of a components remote. Call it in a
 * `'use client'` module of the host. Pass it the descriptor from
 * `getComponentDescriptor` (or `fetchDescriptorInBrowser` in an SPA) only.
 */
export const createRemoteComponent: Bindings['createRemoteComponent'] =
  bindings.createRemoteComponent

/**
 * Registers modules this host provides to every remote component (besides
 * React), as `createRemoteComponent({ shared })` does for one: call it at
 * module scope of a `'use client'` module, before anything renders. The
 * Next.js entries (`@next-federation/next/components`) use it for the
 * host's own `next/*` modules.
 */
export function registerSharedModules(shared: SharedModules): void {
  runtime.registerShared(shared)
}

/**
 * Gives remote components this host's navigation: their links (`next/link`,
 * React Router's `Link` outside their own router, as their build rewired
 * them) and navigation hooks go through these hooks. A plain `<a href>` is
 * never intercepted. Call it once, at module scope of the module that
 * renders the router.
 * React Router's own hooks fit as they are:
 * `provideNavigation({ useNavigate, useHref, useLocation })`. Without it,
 * remote links do full page loads. Next.js hosts need not call it
 * (`@next-federation/next/components` registers the Next.js router).
 */
export function provideNavigation(hooks: NavigationHooks): void {
  const module = navigationModule(hooks)
  registerSharedModules({
    [module.ROUTER_SHARE_NAME]: { version: module.ROUTER_VERSION, module },
  })
}

/**
 * Fetches a remote's current build descriptor in the browser (SPA hosts):
 * no server rendering, so it is never trusted to run server code. null when
 * the remote cannot be reached.
 */
export async function fetchDescriptorInBrowser(
  url: string,
  options: { remote?: string; maxBuilds?: number } = {}
): Promise<RemoteComponentDescriptor | null> {
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store' })
    if (!res.ok) return null
    const file = parseComponentDescriptorFile(await res.json())
    if (!file) return null
    return {
      remote: options.remote ?? file.name,
      name: file.name,
      buildId: file.buildId,
      base: file.base,
      manifest: file.manifest,
      ssr: null,
      // At least one build: 0 or a negative value would never keep any.
      maxBuilds: Math.max(1, Math.floor(options.maxBuilds ?? 5) || 1),
      // Its stylesheets: the browser inserts them before the module loads.
      ...(file.assets === undefined ? {} : { assets: file.assets }),
      // What the host's shared modules must satisfy (checked before loading).
      ...(file.shared === undefined ? {} : { shared: file.shared }),
      ...(file.types === undefined ? {} : { types: file.types }),
    }
  } catch {
    return null
  }
}
