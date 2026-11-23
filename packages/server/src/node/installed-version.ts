import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// `name` or `@scope/name`: never a path (so it never leaves node_modules).
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i

/**
 * @internal — used by nf-expose; not a stable API.
 *
 * The version of package `name` installed for the project at `root`: the
 * `version` of `<dir>/node_modules/<name>/package.json` in the nearest of
 * `root` and its parent folders, as Node finds a package (a hoisted install
 * counts). Read directly, so a package whose `exports` omit
 * `./package.json` is found too. null when it is not installed, its
 * manifest is unreadable or has no version, or `name` is not a package name.
 */
export function installedVersion(root: string, name: string): string | null {
  if (!PACKAGE_NAME.test(name)) return null
  let dir = resolve(root)
  for (;;) {
    let text: string | null = null
    try {
      text = readFileSync(
        join(dir, 'node_modules', name, 'package.json'),
        'utf8'
      )
    } catch {
      text = null
    }
    if (text !== null) {
      try {
        const { version } = JSON.parse(text) as { version?: unknown }
        return typeof version === 'string' && version !== '' ? version : null
      } catch {
        return null
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
