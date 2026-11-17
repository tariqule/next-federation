// `nf-types`: the prop types of remote components, for the host's
// TypeScript. Downloads the declaration files a remote's current build lists
// in its descriptor into the project (`next-federation-types/<remote>/`) and
// writes `next-federation-types/index.d.ts`, which fills the global
// `NextFederationRemoteComponents` interface that `RemoteProps` reads. The
// host never imports remote code at build time: these are type-only files.
//
// Trust: the descriptor is fetched from the remote's configured descriptor
// URL and must verify by the remote's `ssr` trust policy (a signature from
// one of its public keys, or a pinned digest) before anything it names is
// fetched. It signs one entry, the build's declarations index
// (`@mf-types/index.json`, path + sha384); the index's raw bytes must match
// before its file list is used, and every file's raw bytes must match its
// sha384 in the index. Every body comes from under the build's base (the
// remote's origins, no redirects, no credentials) and is read with a byte
// limit. Nothing downloaded is executed.
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import type { ComponentTarget, Federation } from '@next-federation/core'
import {
  fetchComponentDescriptor,
  readBodyLimited,
  verifyDescriptorTrust,
} from '@next-federation/core/components'
import {
  MAX_TYPE_FILES,
  NAME_PATTERN,
  parseComponentTypesIndex,
  sha384Integrity,
} from '@next-federation/protocol'
import type {
  ComponentDescriptorFile,
  ComponentTrustKind,
  ComponentTypesIndex,
} from '@next-federation/protocol'
import { isNFError } from '@next-federation/sdk'

/** The folder `nf-types` writes by default, relative to the project. */
export const DEFAULT_TYPES_DIR = 'next-federation-types'
const META_FILE = 'nf-types.json'
/** The declarations index is refused above this size (2000 entries fit). */
const MAX_INDEX_BYTES = 1024 * 1024

export type SyncTypesOptions = {
  /** The host's `defineFederation(...)` result. */
  federation: Federation
  /** Remotes to sync. Default: every remote with `components`. */
  remotes?: string[]
  /** Output folder (absolute, or relative to the working directory). */
  outDir: string
  /** Injected; defaults to `globalThis.fetch`. */
  fetch?: typeof fetch
  /** Largest declaration file accepted, in bytes. Default 1 MiB. */
  maxFileBytes?: number
  /** Largest total per remote, in bytes. Default 20 MiB. */
  maxTotalBytes?: number
}

export type SyncTypesResult =
  | {
      remote: string
      status: 'written'
      buildId: string
      trust: ComponentTrustKind
      files: number
    }
  | { remote: string; status: 'none'; buildId: string }
  | { remote: string; status: 'failed'; code: string; detail: string }

type Meta = { remote: string; buildId: string; exposes: Record<string, string> }

class SyncError extends Error {
  constructor(
    readonly code: string,
    detail: string
  ) {
    super(detail)
  }
}

async function fetchFile(
  doFetch: typeof fetch,
  url: string,
  target: ComponentTarget,
  maxBytes: number
): Promise<Uint8Array> {
  try {
    const response = await doFetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(target.timeoutMs, 10_000)),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new SyncError('NF-029', `${url} answered HTTP ${response.status}.`)
    }
    // Counted while it streams: a remote can never make the host buffer an
    // unbounded body (content-length or not).
    const bytes = await readBodyLimited(response, maxBytes)
    if (!bytes) {
      throw new SyncError(
        'NF-029',
        `${url} is larger than ${maxBytes} bytes (the per-file or per-build limit).`
      )
    }
    return bytes
  } catch (error) {
    if (error instanceof SyncError) throw error
    throw new SyncError(
      'NF-029',
      `${url} could not be fetched: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** A URL under the build's base on one of the remote's origins; else NF-005. */
function underBase(
  path: string,
  file: ComponentDescriptorFile,
  target: ComponentTarget
): string {
  const url = new URL(path, file.base)
  if (
    !url.href.startsWith(file.base) ||
    !target.allowedOrigins.includes(url.origin)
  ) {
    throw new SyncError(
      'NF-005',
      `${path} is not under build "${file.buildId}"'s base.`
    )
  }
  return url.href
}

async function syncOne(
  options: SyncTypesOptions,
  remote: string,
  outDir: string
): Promise<SyncTypesResult> {
  if (!NAME_PATTERN.test(remote)) {
    throw new SyncError('NF-001', `"${remote}" is not a remote name.`)
  }
  await removeLeftovers(outDir, remote)
  const target = options.federation.componentTarget(remote)
  const doFetch = options.fetch ?? globalThis.fetch
  const fetched = await fetchComponentDescriptor(target, {
    fetch: doFetch,
    init: { cache: 'no-store' },
  })
  if (!fetched.ok) throw new SyncError(fetched.code, fetched.detail)
  const { file } = fetched
  // Before anything it names is fetched.
  const trust = await verifyDescriptorTrust(target, file)
  if (!trust.ok) throw new SyncError(trust.code, trust.detail)
  if (!file.types) {
    // The current (verified) build publishes no types: the previous build's
    // declarations and meta go, so writeIndex drops the remote's entry
    // instead of keeping stale types.
    await rm(join(outDir, remote), { recursive: true, force: true })
    return { remote, status: 'none', buildId: file.buildId }
  }
  // The signed index: its raw bytes must hash to the descriptor's sha384
  // before its file list is used.
  const indexUrl = underBase(file.types.index, file, target)
  const indexBytes = await fetchFile(doFetch, indexUrl, target, MAX_INDEX_BYTES)
  if ((await sha384Integrity(indexBytes)) !== file.types.integrity) {
    throw new SyncError(
      'NF-027',
      `${indexUrl} does not match its sha384 in the descriptor of build "${file.buildId}".`
    )
  }
  let index: ComponentTypesIndex | null = null
  try {
    index = parseComponentTypesIndex(
      JSON.parse(new TextDecoder().decode(indexBytes))
    )
  } catch {
    index = null
  }
  if (!index) {
    throw new SyncError(
      'NF-029',
      `${indexUrl} is not a valid declarations index (at most ${MAX_TYPE_FILES} .d.ts files, plain relative paths).`
    )
  }
  const maxFile = options.maxFileBytes ?? 1024 * 1024
  let budget = options.maxTotalBytes ?? 20 * 1024 * 1024
  const downloaded = new Map<string, Uint8Array>()
  for (const [path, integrity] of Object.entries(index.files)) {
    const url = underBase(path, file, target)
    // Each body is read up to what is left of the build's budget too.
    const bytes = await fetchFile(
      doFetch,
      url,
      target,
      Math.min(maxFile, budget)
    )
    budget -= bytes.byteLength
    // The raw bytes, as hashed at build time (no text decoding).
    if ((await sha384Integrity(bytes)) !== integrity) {
      throw new SyncError(
        'NF-027',
        `${url} does not match its sha384 in the declarations index of build "${file.buildId}".`
      )
    }
    downloaded.set(path, bytes)
  }
  // Every file verified: replace the remote's folder in one rename.
  const folder = join(outDir, remote)
  const staging = join(outDir, `.${remote}-${randomUUID()}`)
  try {
    for (const [path, bytes] of downloaded) {
      const dest = resolve(staging, ...path.split('/'))
      if (!dest.startsWith(`${staging}/`) && !dest.startsWith(`${staging}\\`)) {
        throw new SyncError('NF-005', `${path} leaves the output folder.`)
      }
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, bytes)
    }
    const meta: Meta = {
      remote,
      buildId: file.buildId,
      exposes: index.exposes,
    }
    await writeFile(
      join(staging, META_FILE),
      `${JSON.stringify(meta, null, 2)}\n`
    )
    await replaceFolder(staging, folder)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return {
    remote,
    status: 'written',
    buildId: file.buildId,
    trust: trust.trust,
    files: downloaded.size,
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Staging (`.<remote>-<uuid>`) and set-aside (`.<remote>-old-<uuid>`) folders a crashed run left. */
async function removeLeftovers(outDir: string, remote: string): Promise<void> {
  const escaped = remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const leftover = new RegExp(`^\\.${escaped}-(?:old-)?${UUID}$`)
  for (const entry of await readdir(outDir, { withFileTypes: true })) {
    if (entry.isDirectory() && leftover.test(entry.name)) {
      await rm(join(outDir, entry.name), { recursive: true, force: true })
    }
  }
}

type FolderOps = {
  rename: (from: string, to: string) => Promise<void>
  rm: (path: string, options: { recursive: true; force: true }) => Promise<void>
}

/**
 * Puts `staging` in place of `folder` without a moment where neither
 * exists: the old folder is moved aside, the staged one moved in, and only
 * then the old one removed. When the staged folder cannot be moved in, the
 * old one is moved back (and the error rethrown).
 */
export async function replaceFolder(
  staging: string,
  folder: string,
  ops: FolderOps = { rename, rm }
): Promise<void> {
  const aside = join(
    dirname(folder),
    `.${basename(folder)}-old-${randomUUID()}`
  )
  let moved = false
  try {
    await ops.rename(folder, aside)
    moved = true
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'ENOENT') throw error
  }
  try {
    await ops.rename(staging, folder)
  } catch (error) {
    if (moved) await ops.rename(aside, folder)
    throw error
  }
  if (moved) await ops.rm(aside, { recursive: true, force: true })
}

/** `index.d.ts` from every synced remote folder of `outDir`. */
async function writeIndex(outDir: string): Promise<void> {
  const metas: Meta[] = []
  for (const entry of await readdir(outDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !NAME_PATTERN.test(entry.name)) continue
    try {
      const meta = JSON.parse(
        await readFile(join(outDir, entry.name, META_FILE), 'utf8')
      ) as Meta
      if (meta.remote === entry.name) metas.push(meta)
    } catch {
      // Not a synced remote folder.
    }
  }
  metas.sort((a, b) => (a.remote < b.remote ? -1 : 1))
  const lines = [
    '// Generated by nf-types (@next-federation/next): do not edit.',
    '// The type declarations of each remote build, for `RemoteProps`.',
    'interface NextFederationRemoteComponents {',
  ]
  for (const meta of metas) {
    lines.push(`  ${JSON.stringify(meta.remote)}: {`)
    for (const [expose, path] of Object.entries(meta.exposes).sort()) {
      const specifier = `./${meta.remote}/${path.replace(/\.d\.ts$/, '.js')}`
      lines.push(
        `    ${JSON.stringify(expose)}: typeof import(${JSON.stringify(specifier)})`
      )
    }
    lines.push(`  } // build ${meta.buildId}`)
  }
  lines.push('}', '')
  await writeFile(join(outDir, 'index.d.ts'), lines.join('\n'))
}

/**
 * Syncs the type declarations of each components remote's current build.
 * Never throws for a remote's failure: each result says what happened. A
 * failed remote keeps the declarations it had; a remote whose current build
 * publishes no types (`none`) has its previous declarations removed.
 */
export async function syncRemoteTypes(
  options: SyncTypesOptions
): Promise<SyncTypesResult[]> {
  const outDir = resolve(options.outDir)
  await mkdir(outDir, { recursive: true })
  const remotes =
    options.remotes ??
    options.federation.remotes.filter((remote) => {
      try {
        options.federation.componentTarget(remote)
        return true
      } catch {
        return false
      }
    })
  const results: SyncTypesResult[] = []
  for (const remote of remotes) {
    try {
      results.push(await syncOne(options, remote, outDir))
    } catch (error) {
      if (!(error instanceof SyncError) && !isNFError(error)) throw error
      results.push({
        remote,
        status: 'failed',
        code: (error as { code: string }).code,
        detail: (error as Error).message,
      })
    }
  }
  await writeIndex(outDir)
  return results
}

const USAGE =
  'usage: nf-types --config <module exporting your defineFederation() result> [--remote <name>]... [--out <dir>]\n(default --out: next-federation-types)'

function isFederation(value: unknown): value is Federation {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Federation).componentTarget === 'function' &&
    Array.isArray((value as Federation).remotes)
  )
}

/** The `nf-types` command; resolves to its exit code. */
export async function runTypesCli(
  argv: string[],
  log: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  cwd: string = process.cwd()
): Promise<number> {
  let values: { config?: string; remote?: string[]; out?: string }
  try {
    values = parseArgs({
      args: argv,
      options: {
        config: { type: 'string' },
        remote: { type: 'string', multiple: true },
        out: { type: 'string' },
      },
      strict: true,
    }).values
  } catch (error) {
    log(`${(error as Error).message}\n${USAGE}`)
    return 1
  }
  if (!values.config) {
    log(USAGE)
    return 1
  }
  const mod = (await import(
    /* webpackIgnore: true */ pathToFileURL(resolve(cwd, values.config)).href
  )) as { default?: unknown; federation?: unknown }
  const federation = isFederation(mod.federation) ? mod.federation : mod.default
  if (!isFederation(federation)) {
    log(
      `${values.config} must export your defineFederation() result as \`federation\` or as its default export.`
    )
    return 1
  }
  const results = await syncRemoteTypes({
    federation,
    ...(values.remote ? { remotes: values.remote } : {}),
    outDir: resolve(cwd, values.out ?? DEFAULT_TYPES_DIR),
  })
  let failed = false
  for (const result of results) {
    if (result.status === 'written') {
      log(
        `${result.remote}: build ${result.buildId}, ${result.files} files (${result.trust})`
      )
      if (result.trust === 'unsafe-dev') {
        log(
          `warning: ${result.remote} was trusted by \`integrity: 'unsafe-dev'\` (development only): its declarations are not verified by a signature or a pin.`
        )
      }
    } else if (result.status === 'none') {
      log(`${result.remote}: build ${result.buildId} publishes no types`)
    } else {
      failed = true
      log(`${result.remote}: ${result.code} ${result.detail}`)
    }
  }
  return failed ? 1 : 0
}
