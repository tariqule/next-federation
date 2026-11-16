import type { Federation } from '@next-federation/core'
import { getDescriptorFile } from '@next-federation/next/island-cache'
import { resolveComponentDescriptor } from './component-descriptor.ts'
import type {
  ComponentDescriptorOptions,
  RemoteComponentDescriptor,
} from './component-descriptor.ts'

/**
 * App Router: the build of a components remote this render uses, for
 * `RemoteComponent`'s `descriptor` prop. Call it in a Server Component.
 * Cached per the host's caching model (`next: { revalidate }`, or
 * `'use cache'` + `cacheLife` with cacheComponents); `dynamic: true` fetches
 * per request (inside `<Suspense>` with cacheComponents). Returns the last
 * known build when the remote is down, null when none was ever fetched.
 */
export function getComponentDescriptor(
  federation: Federation,
  remote: string,
  options: ComponentDescriptorOptions = {}
): Promise<RemoteComponentDescriptor | null> {
  return resolveComponentDescriptor(federation, remote, {
    ...options,
    get: getDescriptorFile,
  })
}
