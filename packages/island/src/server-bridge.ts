import type { HostContext, IslandBridge } from '@next-federation/protocol'

/** The bridge used while a remote server-renders an island: nothing to navigate yet. */
export function serverBridge(host: HostContext): IslandBridge {
  return {
    navigate: () => {},
    prefetch: () => {},
    basePath: host.basePath,
    locale: host.locale,
  }
}
