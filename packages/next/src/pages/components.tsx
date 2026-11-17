'use client'
// Remote components in a Pages Router host: `@next-federation/react/components`
// plus the host's own `next/link` and `next/router`, shared with every remote
// (remotes list them in `shared`; host-provided, never bundled), so remote
// links keep the host's basePath and locale. `next/navigation` is not
// provided here: a remote that imports it renders its fallback (NF-036).
import * as base from '@next-federation/react/components'
import * as NextLink from 'next/link'
import * as NextRouter from 'next/router'
import { hostNextVersion } from '../client/next-version.ts'

const version = hostNextVersion()
base.registerSharedModules({
  'next/link': { version, module: NextLink },
  'next/router': { version, module: NextRouter },
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
