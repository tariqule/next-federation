// Dev-only allowlist of Server Action files. In dev, plugin-rsc's
// `loadServerAction(id)` imports whatever file the id names, so the action
// route checks the id against the files the rsc environment has transformed
// with a 'use server' directive BEFORE anything is imported. The plugin (in the
// Vite process) and the rsc entry (in Vite's in-process module runner) are
// different module instances, so they meet in one global slot, keyed by the
// remote's scope key. Production builds resolve ids only from plugin-rsc's
// build manifest and never consult this.

import { trimTrailingSlashes } from '../trim-slashes.ts'

const SLOT = Symbol.for('next-federation.dev-server-actions')

type Entry = { root: string; files: Set<string> }
type Registry = Record<string, Entry>

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>
  return (g[SLOT] ??= {})
}

/** Called by the plugin when the dev server starts. `files` is updated live. */
export function registerDevActions(
  scopeKey: string,
  root: string,
  files: Set<string>
): void {
  registry()[scopeKey] = { root: trimTrailingSlashes(root), files }
}

// `/C:/x` (the path part of `/@fs/C:/x`): a Windows drive letter.
const DRIVE_PATH = /^\/([A-Za-z]):\//

/**
 * True when the file part of a dev action id (`/src/x.ts#name` for files under
 * the root, `/@fs/abs/x.ts#name` outside it) is a recorded Server Action file.
 * On Windows `/@fs/C:/x.ts` names the file id `C:/x.ts`, in either drive case.
 */
export function isDevActionAllowed(scopeKey: string, id: string): boolean {
  const entry = registry()[scopeKey]
  const hash = id.lastIndexOf('#')
  // Dev reference keys are URL paths: always rooted.
  if (!entry || hash <= 0 || !id.startsWith('/')) return false
  const ref = id.slice(0, hash)
  if (!ref.startsWith('/@fs/')) return entry.files.has(`${entry.root}${ref}`)
  const file = ref.slice('/@fs'.length)
  const drive = DRIVE_PATH.exec(file)
  if (!drive) return entry.files.has(file)
  const rest = file.slice(drive[0].length)
  const letter = drive[1]!
  return (
    entry.files.has(`${letter.toUpperCase()}:/${rest}`) ||
    entry.files.has(`${letter.toLowerCase()}:/${rest}`)
  )
}
