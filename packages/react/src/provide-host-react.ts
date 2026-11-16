'use client'

import { islandSharedEntry, islandShareScope } from '@next-federation/protocol'
import React from 'react'
import ReactDOM from 'react-dom'
import ReactDOMClient from 'react-dom/client'
import JsxRuntime from 'react/jsx-runtime'
import {
  HOST_PROVIDER,
  isHostReactProvided,
  peekIslandShareScope,
} from './host-react.ts'

export { isHostReactProvided }

// The CommonJS module objects, exactly what an island's `require('react')`
// would return from its own copy.
const HOST_LIBS: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': JsxRuntime,
}

function isProduction(): boolean {
  try {
    // Bundlers replace the whole expression; a page without one has no `process`.
    return process.env.NODE_ENV === 'production'
  } catch {
    return false
  }
}

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
export function provideHostReact(): boolean {
  const { version } = React
  if (version.includes('-') || !isProduction()) return false
  const existing = peekIslandShareScope()
  const names = Object.keys(HOST_LIBS)
  if (names.some((name) => existing?.[name]?.[version])) {
    return isHostReactProvided()
  }
  const scope = islandShareScope()
  for (const name of names) {
    const lib = HOST_LIBS[name]
    const entry = islandSharedEntry(version, HOST_PROVIDER, () =>
      Promise.resolve(() => lib)
    )
    entry.loaded = true
    entry.lib = () => lib
    ;(scope[name] ??= {})[version] = entry
  }
  return true
}
