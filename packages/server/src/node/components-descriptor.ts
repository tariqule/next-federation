// The Mode A build descriptor, bundler-neutral: shared by
// @next-federation/vite's nextFederationComponents and `nf-describe` (any
// Module Federation 2.0 build), so both write exactly the same file.
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  COMPONENTS_JWS_TYPE,
  componentDescriptorBytes,
  componentDescriptorDigest,
  isSemverRange,
  isSemverVersion,
  sha384Integrity,
} from '@next-federation/protocol'
import type {
  ComponentBuildAssets,
  ComponentBuildDescriptor,
  ComponentDescriptorFile,
  ComponentSharedModule,
} from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import { CompactSign, importJWK } from 'jose'
import type { JWK } from 'jose'

/** Written next to `client/` in every components build (nf-serve reads it). */
export type ComponentsBuildInfo = {
  kind: 'components'
  name: string
  buildId: string
  builtAt: number
  base: string
}

/** `require("./x")` / `require("../x")` in the CommonJS server build. */
const RELATIVE_REQUIRE = /require\(["'](\.\.?\/[^"']+)["']\)/g

type ManifestEntry = { name?: unknown; path?: unknown }
type ManifestFiles = { sync?: unknown; async?: unknown }
type Manifest = {
  metaData?: { remoteEntry?: ManifestEntry; ssrRemoteEntry?: ManifestEntry }
  exposes?: Array<{
    path?: unknown
    assets?: { js?: ManifestFiles; css?: ManifestFiles }
  }>
}

/** A manifest file path as an absolute URL under `base`; NF-002 outside it. */
function underBase(base: string, file: unknown): string {
  const parts = typeof file === 'string' ? file.split('/') : []
  if (
    parts.length === 0 ||
    (file as string).includes('\\') ||
    !parts.every((p) => p !== '' && p !== '.' && p !== '..' && !/[?#:]/.test(p))
  ) {
    throw new NFError(
      'NF-002',
      `mf-manifest.json lists ${JSON.stringify(file)}, which is not a file inside the build folder.`
    )
  }
  const url = `${base}${file as string}`
  if (new URL(url).href !== url) {
    throw new NFError(
      'NF-002',
      `mf-manifest.json lists ${JSON.stringify(file)}, whose URL is not in normal form (rename the file).`
    )
  }
  return url
}

const syncFiles = (files: ManifestFiles | undefined): unknown[] =>
  Array.isArray(files?.sync) ? (files.sync as unknown[]) : []

/**
 * The browser files of every exposed module, from the built
 * `mf-manifest.json`: the remote entry and, per expose, its synchronous
 * stylesheets and JavaScript chunks, as absolute URLs under `base`. Hosts
 * render stylesheet links (server-rendered components are styled before
 * they hydrate) and modulepreload links (no manifest, entry, chunk
 * waterfall) for exactly these URLs; they are signed with the descriptor.
 */
export async function collectBrowserAssets(
  dir: string,
  base: string
): Promise<ComponentBuildAssets> {
  const manifest = JSON.parse(
    await readFile(join(resolve(dir), 'mf-manifest.json'), 'utf8')
  ) as Manifest
  const entry = manifest.metaData?.remoteEntry
  const entryPath =
    typeof entry?.path === 'string' && entry.path !== ''
      ? `${entry.path.replace(/^\/+|\/+$/g, '')}/${String(entry.name)}`
      : entry?.name
  const exposes: ComponentBuildAssets['exposes'] = {}
  for (const expose of manifest.exposes ?? []) {
    if (typeof expose.path !== 'string') continue
    const key = expose.path.startsWith('./') ? expose.path : `./${expose.path}`
    exposes[key] = {
      css: [...new Set(syncFiles(expose.assets?.css))].map((f) =>
        underBase(base, f)
      ),
      js: [...new Set(syncFiles(expose.assets?.js))].map((f) =>
        underBase(base, f)
      ),
    }
  }
  return { entry: underBase(base, entryPath), exposes }
}

/**
 * NF-002 unless `file` is a regular file (not a symlink) whose real path is
 * inside `realRoot` (the real path of the build folder): a symlink, or a
 * symlinked folder on the way, could make a build hash or publish files from
 * anywhere on the build machine.
 */
export async function assertBuildFile(
  file: string,
  realRoot: string,
  label: string
): Promise<void> {
  const stat = await lstat(file)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new NFError(
      'NF-002',
      `${label} is ${stat.isSymbolicLink() ? 'a symlink' : 'not a regular file'}: a build's files must be regular files inside its folder.`
    )
  }
  const rel = relative(realRoot, await realpath(file))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new NFError(
      'NF-002',
      `${label} resolves outside the build folder (through a symlinked folder).`
    )
  }
}

/**
 * NF-002 unless `dir` is a real directory (not a symlink) whose real path is
 * inside `realParent`: a symlinked `client/` would move the whole build
 * folder, and every check relative to it, somewhere else.
 */
export async function assertBuildDir(
  dir: string,
  realParent: string,
  label: string
): Promise<void> {
  const stat = await lstat(dir)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new NFError(
      'NF-002',
      `${label} is ${stat.isSymbolicLink() ? 'a symlink' : 'not a directory'}: a build's folders must be real directories inside it.`
    )
  }
  const rel = relative(realParent, await realpath(dir))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new NFError('NF-002', `${label} resolves outside the build folder.`)
  }
}

/** NF-002 when a folder between `root` and `file` is a symlink. */
async function assertRealDirs(root: string, file: string): Promise<void> {
  let current = root
  for (const part of relative(root, dirname(file)).split(sep)) {
    if (part === '') continue
    current = join(current, part)
    const stat = await lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new NFError(
        'NF-002',
        `${relative(root, current).split(sep).join('/')}/ is ${stat.isSymbolicLink() ? 'a symlink' : 'not a directory'}: a build's folders must be real directories inside it.`
      )
    }
  }
}

/**
 * The integrity map of a build's server code: the sha384 of `mf-manifest.json`
 * and of every file reachable from the SSR entry through relative
 * `require()`s, keyed by path relative to the build folder (= its base URL).
 * NF-002 when the manifest names no SSR entry or the graph leaves the folder.
 */
export async function collectServerIntegrity(
  dir: string
): Promise<Record<string, string>> {
  const root = resolve(dir)
  const realRoot = await realpath(root)
  await assertBuildFile(
    join(root, 'mf-manifest.json'),
    realRoot,
    'mf-manifest.json'
  )
  const manifestBytes = await readFile(join(root, 'mf-manifest.json'))
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest
  const entry = manifest.metaData?.ssrRemoteEntry
  if (typeof entry?.name !== 'string' || entry.name === '') {
    throw new NFError(
      'NF-002',
      'mf-manifest.json names no ssrRemoteEntry: the server build did not run.'
    )
  }
  const integrity: Record<string, string> = {
    'mf-manifest.json': await sha384Integrity(manifestBytes),
  }
  const pending = [
    resolve(root, typeof entry.path === 'string' ? entry.path : '', entry.name),
  ]
  while (pending.length > 0) {
    const file = pending.pop()!
    const rel = relative(root, file).split(sep).join('/')
    if (rel === '' || rel.startsWith('..') || resolve(root, rel) !== file) {
      throw new NFError(
        'NF-002',
        `The server build requires ${JSON.stringify(rel)}, outside the build folder.`
      )
    }
    if (rel in integrity) continue
    await assertRealDirs(root, file)
    await assertBuildFile(file, realRoot, rel)
    const bytes = await readFile(file)
    integrity[rel] = await sha384Integrity(bytes)
    for (const match of bytes.toString('utf8').matchAll(RELATIVE_REQUIRE)) {
      pending.push(resolve(file, '..', match[1]!))
    }
  }
  return integrity
}

/** Always the host's (never in the descriptor's `shared`). */
const HOST_REACT = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
])
/** The host's router modules: shared, never a fallback copy. */
const NEXT_SHARED = new Set(['next/link', 'next/navigation', 'next/router'])
const BARE_SPECIFIER =
  /^(?:@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(?:\/[\w.@-]+)*$/i

/**
 * Written by `nextFederationComponents` next to `client/`: the shared modules
 * each exposed module imports (`{ "./Counter": ["ctx"] }`, or null when
 * unknown). nf-describe reads it too, so describing a Vite build again gives
 * the same descriptor; other bundlers have none (every expose is checked).
 */
export const SHARED_USAGE_FILE = 'nf-shared-usage.json'

/** Expose key -> the shared specifiers its module graph imports. */
export type SharedUsage = Map<string, Set<string>>

/** The usage file of a build folder; null when it is absent (unknown). */
export async function readSharedUsage(
  buildDir: string
): Promise<SharedUsage | null> {
  const file = join(resolve(buildDir), SHARED_USAGE_FILE)
  let stat
  try {
    stat = await lstat(file)
  } catch {
    return null
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new NFError(
      'NF-002',
      `${SHARED_USAGE_FILE} must be a regular file inside the build folder.`
    )
  }
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const usage: SharedUsage = new Map()
  for (const [expose, names] of Object.entries(raw)) {
    if (!Array.isArray(names)) return null
    usage.set(
      expose,
      new Set(names.filter((n): n is string => typeof n === 'string'))
    )
  }
  return usage
}

type ManifestShared = {
  name?: unknown
  version?: unknown
  singleton?: unknown
  requiredVersion?: unknown
}

/**
 * The descriptor's signed `shared` field from a built `mf-manifest.json`:
 * every shared module but React, with the range the host's copy must
 * satisfy (false: any; a range hosts cannot evaluate counts as any), and
 * `fallback` for a bundled copy (a non-singleton share: Module Federation
 * picks a satisfying copy or the build's own), with that copy's version.
 * `next/*` never falls back. `usage` (per expose) adds `exposes`; without
 * it every expose is checked. undefined when there is nothing to list, so
 * the digest of such a build is what older hosts compute.
 */
export function sharedFromManifest(
  manifest: unknown,
  usage: SharedUsage | null
): Record<string, ComponentSharedModule> | undefined {
  const list = (manifest as { shared?: unknown } | null)?.shared
  const out: Record<string, ComponentSharedModule> = {}
  for (const item of Array.isArray(list) ? (list as ManifestShared[]) : []) {
    const name = item?.name
    if (typeof name !== 'string' || !BARE_SPECIFIER.test(name)) continue
    if (HOST_REACT.has(name)) continue
    const range = item.requiredVersion
    const fallback = item.singleton === false && !NEXT_SHARED.has(name)
    const entry: ComponentSharedModule = {
      requiredVersion:
        typeof range === 'string' && isSemverRange(range) ? range : false,
      fallback,
    }
    if (
      fallback &&
      typeof item.version === 'string' &&
      isSemverVersion(item.version)
    ) {
      entry.version = item.version
    }
    if (usage) {
      entry.exposes = [...usage.entries()]
        .filter(([, names]) => names.has(name))
        .map(([expose]) => expose)
        .sort()
    }
    out[name] = entry
  }
  return Object.keys(out).length === 0 ? undefined : out
}

async function signingKey(raw: string) {
  let jwk: JWK
  try {
    jwk = JSON.parse(raw) as JWK
  } catch {
    throw new NFError(
      'NF-002',
      'NF_COMPONENTS_SIGNING_KEY must be a private EC P-256 JWK (JSON).'
    )
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') {
    throw new NFError(
      'NF-002',
      'NF_COMPONENTS_SIGNING_KEY must be a private EC P-256 JWK (kty "EC", crv "P-256", with "d").'
    )
  }
  return { key: await importJWK(jwk, 'ES256'), kid: jwk.kid }
}

/**
 * The descriptor file for a build: the payload, its digest and, when
 * `NF_COMPONENTS_SIGNING_KEY` holds a private JWK, a compact ES256 JWS of the
 * canonical payload (the key never leaves the build machine).
 */
export async function createDescriptorFile(
  payload: ComponentBuildDescriptor,
  env: Record<string, string | undefined>
): Promise<ComponentDescriptorFile> {
  const digest = await componentDescriptorDigest(payload)
  const raw = env.NF_COMPONENTS_SIGNING_KEY
  if (!raw) return { ...payload, digest }
  const { key, kid } = await signingKey(raw)
  const jws = await new CompactSign(componentDescriptorBytes(payload))
    .setProtectedHeader({
      alg: 'ES256',
      typ: COMPONENTS_JWS_TYPE,
      ...(kid ? { kid } : {}),
    })
    .sign(key)
  return { ...payload, digest, jws }
}
