import type { IslandShareScope } from '@next-federation/protocol'
/** The `from` of the entries `provideHostReact()` registers. */
export declare const HOST_PROVIDER = 'host'
/** The island share scope, if the page has one; never creates it. */
export declare function peekIslandShareScope(): IslandShareScope | undefined
/**
 * True once `provideHostReact()` put this host's React into the island share
 * scope: islands on the same React version then run on the host's React.
 */
export declare function isHostReactProvided(): boolean
