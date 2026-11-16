import type { Federation } from '@next-federation/core'
import { getDescriptorFile } from '../server/island-cache.legacy.ts'
import { resolveComponentDescriptor } from '../server/component-descriptor.ts'
import type {
  ComponentDescriptorOptions,
  RemoteComponentDescriptor,
} from '../server/component-descriptor.ts'

/**
 * Pages Router: the build of a components remote this render uses, for
 * `RemoteComponent`'s `descriptor` prop. Call it in `getServerSideProps` or
 * `getStaticProps` and return it in `props`. Returns the last known build
 * when the remote is down, null when none was ever fetched.
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
