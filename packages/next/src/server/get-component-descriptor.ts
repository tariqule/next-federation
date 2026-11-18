import type { Federation } from '@next-federation/core'
import {
  getDescriptorFile,
  skipStaticShellUntilReady,
} from '@next-federation/next/island-cache'
import { resolveComponentDescriptor } from './component-descriptor.ts'
import type {
  ComponentDescriptorOptions,
  RemoteComponentDescriptor,
} from './component-descriptor.ts'

/**
 * App Router: the build of a components remote this render uses, for the
 * `descriptor` prop of a component made with `createRemoteComponent`. Call it
 * in a Server Component. Cached per the host's caching model
 * (`next: { revalidate }`, or `'use cache'` + `cacheLife` with
 * cacheComponents); `dynamic: true` fetches per request (inside `<Suspense>`
 * with cacheComponents). Returns the last known build when the remote is down,
 * null when none was ever fetched. With cacheComponents, a render in a server
 * process that has not loaded the build yet is left out of the static shell
 * (`NF-039` is logged), so a static regeneration never keeps the components'
 * fallback as the page.
 */
export async function getComponentDescriptor(
  federation: Federation,
  remote: string,
  options: ComponentDescriptorOptions = {}
): Promise<RemoteComponentDescriptor | null> {
  const descriptor = await resolveComponentDescriptor(federation, remote, {
    ...options,
    get: getDescriptorFile,
  })
  // cacheComponents: a static regeneration before this process loaded the
  // build is kept out of the static shell instead of caching the fallback.
  await skipStaticShellUntilReady(descriptor)
  return descriptor
}
