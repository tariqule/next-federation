'use client'
// Remote components in an App Router host: `@next-federation/react/components`
// plus the host's own `next/link` and `next/navigation`, shared with every
// remote (remotes list them in `shared`; host-provided, never bundled), and
// `@next-federation/router` backed by them (./router-module.tsx).
// Imported here, so Next resolves its own App Router copies in each layer
// (SSR and browser), the way the React entry registers React. Shared with
// the guards every router module has (`@next-federation/router/next-host`):
// a link off this origin is a plain anchor, a navigation off it is dropped.
// `next/router` is not provided: it has no router in the App Router, so a
// remote that imports it renders its fallback (NF-036).
import * as base from '@next-federation/react/components'
import * as NextLink from 'next/link'
import * as NextNavigation from 'next/navigation'
import { ROUTER_SHARE_NAME, ROUTER_VERSION } from '@next-federation/router'
import {
  guardNextLink,
  guardNextNavigation,
} from '@next-federation/router/next-host'
import { hostNextVersion } from './next-version.ts'
import { nextAppRouterModule } from './router-module.tsx'

const version = hostNextVersion()
base.registerSharedModules({
  'next/link': { version, module: guardNextLink(NextLink) },
  'next/navigation': { version, module: guardNextNavigation(NextNavigation) },
  [ROUTER_SHARE_NAME]: { version: ROUTER_VERSION, module: nextAppRouterModule },
})

// Own functions, not re-exports: a bundler may resolve a re-export of a
// side-effect-free package straight to its source and never run this module
// (and so never register the modules above).
export function createRemoteComponent<
  P extends object = Record<string, unknown>,
>(options: base.RemoteComponentOptions): base.RemoteComponentType<P> {
  return base.createRemoteComponent<P>(options)
}
export const loadRemoteModule: typeof base.loadRemoteModule = (
  descriptor,
  expose
) => base.loadRemoteModule(descriptor, expose)
export const preloadRemoteComponent: typeof base.preloadRemoteComponent = (
  descriptor,
  expose
) => base.preloadRemoteComponent(descriptor, expose)
export const registerSharedModules: typeof base.registerSharedModules = (
  shared
) => base.registerSharedModules(shared)
export const COMPONENT_EVENT: string = base.COMPONENT_EVENT
export type {
  ComponentEvent,
  RemoteComponentDescriptor,
  RemoteComponentOptions,
  RemoteComponentProps,
  RemoteComponentType,
  RemoteModule,
  RemoteProps,
  SharedModules,
} from '@next-federation/react/components'
