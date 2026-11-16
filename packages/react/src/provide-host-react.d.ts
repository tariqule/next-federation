import { isHostReactProvided } from './host-react.ts'
export { isHostReactProvided }
/**
 * Puts this host's React (react, react-dom, react-dom/client and
 * react/jsx-runtime) into the island share scope, so islands built on the
 * same exact React version use it and download no React of their own.
 *
 * Call it at module scope of the app entry (the SPA entry, or `pages/_app`),
 * before the first island bootstraps; calling it later is harmless. Returns
 * true when the host's React is the provider of its version. Returns false and
 * does nothing when React's version has a pre-release tag (canary or
 * experimental: every App Router host, whose React is Next's own canary), in
 * development, or when an island already provides that version (the host's
 * react-dom next to an island's react would pair two Reacts).
 */
export declare function provideHostReact(): boolean
