import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NFError } from '@next-federation/sdk'

/** What `withNextFederation` needs to know about the host's installed Next.js. */
export type InstalledNext = {
  version: string
  /** Where `next/package.json` resolved, for error messages. */
  path: string
  /** `cacheComponents` exists: Next 16 and later (stable `cacheLife` in `next/cache`). */
  cacheComponents: boolean
}

type NodeRequire = ((id: string) => unknown) & {
  resolve?: (id: string) => string
}

/**
 * The Next.js installed for `from` (a folder, or a module URL), read from its
 * `next/package.json` only (no internals, and no Next module is loaded at
 * config time). `cacheComponents` follows the major: Next 16 made it stable.
 * Looks in `node_modules` folders from `from` upwards only, so `NODE_PATH`
 * (which pnpm sets for scripts) cannot make a folder without its own Next
 * look like it has one. `resolve: true` uses Node's full resolution instead
 * (Yarn Plug'n'Play has no `node_modules`). Null when none is found.
 */
export function readNext(
  from: string,
  options: { resolve?: boolean } = {}
): InstalledNext | null {
  let dir = from.startsWith('file:') ? dirname(fileURLToPath(from)) : from
  if (!options.resolve) {
    for (;;) {
      if (existsSync(join(dir, 'node_modules', 'next', 'package.json'))) break
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }
  const base = join(dir, 'package.json')
  try {
    const load = createRequire(base) as NodeRequire
    const version = (load('next/package.json') as { version?: unknown }).version
    if (typeof version !== 'string' || version === '') return null
    const path =
      typeof load.resolve === 'function'
        ? dirname(load.resolve('next/package.json'))
        : join(dir, 'node_modules', 'next')
    return { version, path, cacheComponents: major(version) >= 16 }
  } catch {
    return null
  }
}

function major(version: string): number {
  return Number.parseInt(version, 10)
}

/**
 * The host's Next.js. Next's CLI never changes directory, so `next build
 * apps/web` run from a monorepo root has the root as cwd while the project
 * (where next.config lives) is apps/web: both are read. When both resolve a
 * Next.js and the majors differ, which one runs is ambiguous: NF-002 naming
 * both. Otherwise the project's wins, then cwd's; when neither folder has a
 * `node_modules/next`, Node's own resolution from them, then from this
 * package. NF-002 when none is readable.
 */
export function installedNext(
  projectDir: string | null,
  cwd: string = process.cwd()
): InstalledNext {
  const fromProject = projectDir === null ? null : readNext(projectDir)
  const fromCwd = readNext(cwd)
  if (
    fromProject &&
    fromCwd &&
    major(fromProject.version) !== major(fromCwd.version)
  ) {
    throw new NFError(
      'NF-002',
      `Two Next.js majors are installed for this build: ${fromProject.version} for the project (${projectDir}, from ${fromProject.path}) and ${fromCwd.version} for the working directory (${cwd}, from ${fromCwd.path}). withNextFederation cannot tell which one runs: install one Next.js major for both, or run \`next\` from the project folder.`
    )
  }
  const found =
    fromProject ??
    fromCwd ??
    (projectDir === null ? null : readNext(projectDir, { resolve: true })) ??
    readNext(cwd, { resolve: true }) ??
    readNext(import.meta.url, { resolve: true })
  if (found) return found
  throw new NFError(
    'NF-002',
    "withNextFederation could not read the installed Next.js version (next/package.json): remote components check remotes' next/* ranges against it. Install `next` where @next-federation/next can resolve it."
  )
}

/** A frame location's start: an absolute POSIX path, a file URL or a Windows drive. */
const LOCATION_START = /^(?:\/|file:|[A-Za-z]:[\\/])/
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/
const WINDOWS_FILE_URL = /^file:\/\/\/[A-Za-z]:\//i

/**
 * The folder of the file at the top of a V8 stack (captured with the
 * wrapper as the boundary, so the top frame is its caller: the host's
 * next.config, or the file Next compiled it to in the same folder). Frames
 * are `at name (location:line:col)` or `at location:line:col`, and the
 * location may itself contain spaces and parentheses (`proj (copy)`). Null
 * when the frame has no file path.
 */
export function callerDir(stack: string | undefined): string | null {
  const frame = stack
    ?.split('\n')
    .slice(1)
    .map((line) => line.trim())
    .find((line) => line.startsWith('at '))
  if (!frame) return null
  const end = /:\d+:\d+\)?$/.exec(frame)
  if (!end) return null
  const body = frame.slice(3, end.index)
  // The location is what follows `at `, or the first `(` that opens a path.
  let file = LOCATION_START.test(body) ? body : null
  for (let i = body.indexOf('('); file === null && i !== -1; ) {
    if (LOCATION_START.test(body.slice(i + 1))) file = body.slice(i + 1)
    else i = body.indexOf('(', i + 1)
  }
  if (file === null) return null
  if (file.startsWith('file:')) {
    try {
      // A drive-letter URL is a Windows path wherever this runs.
      file = WINDOWS_FILE_URL.test(file)
        ? fileURLToPath(file, { windows: true })
        : fileURLToPath(file)
    } catch {
      return null
    }
  }
  // Windows stacks print `C:\dir\file.js`: parsed as a Windows path on any OS.
  if (WINDOWS_PATH.test(file)) return win32.dirname(file)
  return isAbsolute(file) ? dirname(file) : null
}

const NEXT_CONFIGS = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map(
  (ext) => `next.config.${ext}`
)

/**
 * The Next project folder, from the stack captured at the wrapper's call:
 * the caller's folder when it holds a `next.config.*` (the wrapper called
 * from a host's next.config), else null (called from a helper elsewhere), so
 * only the working directory is read.
 */
export function nextProjectDir(stack: string | undefined): string | null {
  const dir = callerDir(stack)
  if (dir === null) return null
  return NEXT_CONFIGS.some((name) => existsSync(join(dir, name))) ? dir : null
}
