'use client'
// Remote components in a Pages Router host: `@next-federation/react/components`
// plus the host's own `next/link` and `next/router`, shared with every remote
// (remotes list them in `shared`; host-provided, never bundled), so remote
// links keep the host's basePath and locale; `@next-federation/router` is
// backed by them (./router-module.tsx). Shared with the guards every router
// module has (`@next-federation/router/next-host`): a link off this origin is
// a plain anchor (React 18 renders a `javascript:` href as it is), a
// navigation off it is dropped. `next/navigation` is not provided here: a
// remote that imports it renders its fallback (NF-036).
import * as base from '@next-federation/react/components'
import { registerPagesShared } from './register-shared.ts'

registerPagesShared()

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
export function preloadRemoteComponent(
  descriptor: base.RemoteComponentDescriptor | null,
  expose: string
): Promise<void>
export function preloadRemoteComponent(
  descriptor: base.RemoteComponentDescriptor | null,
  expose: string,
  options: base.PreloadOptions
): Promise<base.PreloadResult>
export function preloadRemoteComponent(
  descriptor: base.RemoteComponentDescriptor | null,
  expose: string,
  options?: base.PreloadOptions
): Promise<void | base.PreloadResult>
export function preloadRemoteComponent(
  descriptor: base.RemoteComponentDescriptor | null,
  expose: string,
  options?: base.PreloadOptions
): Promise<void | base.PreloadResult> {
  return base.preloadRemoteComponent(descriptor, expose, options)
}
export const registerSharedModules: typeof base.registerSharedModules = (
  shared
) => base.registerSharedModules(shared)
export const COMPONENT_EVENT: string = base.COMPONENT_EVENT
export type {
  ComponentEvent,
  PreloadOptions,
  PreloadResult,
  PreloadState,
  RemoteComponentDescriptor,
  RemoteComponentOptions,
  RemoteComponentProps,
  RemoteComponentType,
  RemoteModule,
  RemoteProps,
  SharedModules,
} from '@next-federation/react/components'
