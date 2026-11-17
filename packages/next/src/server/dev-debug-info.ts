/** Why React's development debug info may carry what this library awaits. */
export type DevDebugInfoCause = 'linked' | 'source-maps-off'

/**
 * Under `next dev`, React sends the values Server Components await to the
 * browser as debug info, except in code Next's dev tooling recognises as a
 * dependency: a stack frame under node_modules, or covered by an ignore-listed
 * source map. That fails when this library runs from outside node_modules (a
 * workspace link, `npm link`: `linked`), and may fail when Node runs without
 * source maps (`next dev --disable-source-maps`: `source-maps-off`; a runtime
 * without `process.sourceMapsEnabled` counts as off). Reads only this
 * module's own URL and the public `process.sourceMapsEnabled`.
 */
export function devDebugInfoCause(
  url: string = import.meta.url,
  sourceMapsEnabled: unknown = (process as { sourceMapsEnabled?: unknown })
    .sourceMapsEnabled
): DevDebugInfoCause | null {
  if (!url.includes('/node_modules/')) return 'linked'
  if (sourceMapsEnabled !== true) return 'source-maps-off'
  return null
}
