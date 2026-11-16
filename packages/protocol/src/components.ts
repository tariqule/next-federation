// Mode A (Module Federation client components) wire format v1: the build
// descriptor a components remote publishes for each build. Bundler-neutral.
import { BUILD_ID_PATTERN, NAME_PATTERN, SHA384_PATTERN } from './constants.ts'
import { canonicalJson } from './props.ts'
import { isSemverRange, isSemverVersion } from './semver.ts'

/** The current build's descriptor; `/b/<buildId>/nf-components.json` names one build. */
export const COMPONENTS_DESCRIPTOR_PATH = '/_nf/components.json'
/** File name of a build's descriptor, in the build folder and under its base. */
export const COMPONENTS_DESCRIPTOR_FILE = 'nf-components.json'
/** The JWS `typ` header of a signed descriptor. */
export const COMPONENTS_JWS_TYPE = 'nf-components+jws'

/** The browser files of one exposed module: absolute URLs under `base`. */
export type ComponentExposeAssets = {
  /** Stylesheets the module needs (Vite's CSS chunks), in load order. */
  css: string[]
  /** Its JavaScript chunks, which hosts `modulepreload` when server rendering. */
  js: string[]
}

/**
 * The browser files of a build, signed with the rest of the payload: hosts
 * render stylesheet and modulepreload links only for URLs listed here.
 */
export type ComponentBuildAssets = {
  /** Absolute URL of the browser remote entry (`remoteEntry.js`). */
  entry: string
  /** Keyed by exposed module ('./Counter'). */
  exposes: Record<string, ComponentExposeAssets>
}

/**
 * One module the build expects from its host (`shared` in the remote's
 * config, besides React, which is always the host's): what the host's copy
 * must satisfy, and whether the build carries its own copy to use otherwise.
 */
export type ComponentSharedModule = {
  /** A semver range the host's version must satisfy; false: any version. */
  requiredVersion: string | false
  /**
   * true: the build bundles its own copy and uses it when the host does not
   * provide the module or its version does not satisfy `requiredVersion`.
   * false: host-provided only (a missing or unsatisfying copy is NF-036).
   */
  fallback: boolean
  /** The exposed modules ('./Name') that import it; absent: every one. */
  exposes?: string[]
  /** With `fallback`: the version of the build's own copy. */
  version?: string
}

/** What a build signs (or a host pins): everything a host trusts about it. */
export type ComponentBuildDescriptor = {
  v: 1
  /** The Module Federation container name. */
  name: string
  buildId: string
  /** Absolute, immutable per-build URL prefix; ends with '/'. */
  base: string
  /** Absolute URL of the build's `mf-manifest.json`, under `base`. */
  manifest: string
  /**
   * The server (CommonJS) build: the sha384 of every file the host may fetch
   * and evaluate (paths relative to `base`, including `mf-manifest.json`).
   * null: the build has no server code; hosts render it in the browser only.
   */
  ssr: null | { integrity: Record<string, string> }
  /** Build time, seconds since the epoch (signed; hosts may bound its age). */
  iat?: number
  /** The browser files (stylesheets, chunks); absent in dev and older builds. */
  assets?: ComponentBuildAssets
  /** Modules the build expects from its host, by specifier; absent in older builds. */
  shared?: Record<string, ComponentSharedModule>
}

/** The published file: the payload, its digest and optionally its ES256 JWS. */
export type ComponentDescriptorFile = ComponentBuildDescriptor & {
  /** `sha384-<base64>` of `canonicalJson(payload)`; hosts can pin it. */
  digest: string
  /** Compact JWS (ES256) whose payload is `canonicalJson(payload)`. */
  jws?: string
}

/**
 * What a host passes to `RemoteComponent`: one build, resolved on the server
 * (or in the browser for an SPA). `ssr` is non-null only when the host
 * verified the build's server code (signature, pinned digest or `unsafe-dev`).
 */
export type RemoteComponentDescriptor = {
  /** The host's key for this remote (defineFederation `remotes`). */
  remote: string
  name: string
  buildId: string
  base: string
  manifest: string
  ssr: null | { integrity: Record<string, string> }
  /** Distinct builds of this remote a process keeps loaded. */
  maxBuilds: number
  iat?: number
  /** The build's browser files, as in its descriptor. */
  assets?: ComponentBuildAssets
  /** The modules the build expects from its host, as in its descriptor. */
  shared?: Record<string, ComponentSharedModule>
  /**
   * The build's JWS, carried so a server can re-verify the descriptor
   * itself (a cached descriptor after a restart): `ssr` alone is never trusted.
   */
  jws?: string
}

/** A host's trust policy for one remote (registered by defineFederation). */
export type ComponentTrustPolicy = {
  publicKeys: Array<{
    kty: 'EC'
    crv: 'P-256'
    x: string
    y: string
    kid?: string
  }>
  pinned: Record<string, string>
  unsafeDev: boolean
  /** Seconds a signed build stays acceptable after its `iat`; null: no bound. */
  maxAgeSeconds: number | null
  /** The expected container name; null: any. */
  name: string | null
  /** Origins a build of this remote may be served from. */
  allowedOrigins: string[]
}

/** How a build's server code was trusted. */
export type ComponentTrustKind = 'signature' | 'pinned' | 'unsafe-dev'

/**
 * Server-side, process-wide: the digests of descriptors verified in this
 * process (with how they were trusted: `ssr.maxAge` bounds signed builds
 * only), and each remote's trust policies. The server loader evaluates a
 * build only when its descriptor is in `verified` or re-verifies against
 * `trust`; a descriptor prop alone (ssr.integrity) is never trusted.
 */
export type ComponentTrustRegistry = {
  verified: Map<string, ComponentTrustKind>
  trust: Map<string, ComponentTrustPolicy[]>
  /**
   * The React of every server-side remote component runtime in this process
   * (one per Next layer): more than one means a mixed-router host.
   */
  reacts?: Set<unknown>
}

const TRUST_REGISTRY = Symbol.for('nf.components.verified')

/** The registry key of a verified descriptor: its digest, bound to its remote. */
export function verifiedKey(remote: string, digest: string): string {
  return `${remote}\n${digest}`
}

/** The process-wide trust registry (created on first use). Server only. */
export function componentTrustRegistry(): ComponentTrustRegistry {
  const g = globalThis as Record<symbol, ComponentTrustRegistry | undefined>
  return (g[TRUST_REGISTRY] ??= { verified: new Map(), trust: new Map() })
}

/** Wall-clock seconds without `Date.now()` (cacheComponents prerenders flag it). */
export function nowSeconds(): number {
  return Math.floor((performance.timeOrigin + performance.now()) / 1000)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function absoluteBase(value: unknown): string | null {
  if (typeof value !== 'string' || !value.endsWith('/')) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.search || url.hash || url.href !== value) return null
    return value
  } catch {
    return null
  }
}

/** A path relative to `base` that stays inside it. */
function insidePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\')) return false
  return path
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..')
}

function parseIntegrity(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  const out: Record<string, string> = {}
  for (const [path, hash] of Object.entries(value)) {
    if (
      !insidePath(path) ||
      typeof hash !== 'string' ||
      !SHA384_PATTERN.test(hash)
    ) {
      return null
    }
    out[path] = hash
  }
  return out
}

/** An absolute URL under `base` (no query or fragment); null otherwise. */
function urlUnder(value: unknown, base: string): string | null {
  if (typeof value !== 'string' || !value.startsWith(base)) return null
  if (!insidePath(value.slice(base.length))) return null
  try {
    const url = new URL(value)
    if (url.search || url.hash || url.href !== value) return null
  } catch {
    return null
  }
  return value
}

function urlsUnder(value: unknown, base: string): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value) {
    const url = urlUnder(item, base)
    if (!url) return null
    out.push(url)
  }
  return out
}

function parseAssets(
  value: unknown,
  base: string
): ComponentBuildAssets | null {
  if (!isRecord(value) || !isRecord(value.exposes)) return null
  const entry = urlUnder(value.entry, base)
  if (!entry) return null
  const exposes: Record<string, ComponentExposeAssets> = {}
  for (const [key, files] of Object.entries(value.exposes)) {
    // Expose keys as Module Federation writes them: './Name'.
    if (!isExposeKey(key) || !isRecord(files)) {
      return null
    }
    const css = urlsUnder(files.css, base)
    const js = urlsUnder(files.js, base)
    if (!css || !js) return null
    exposes[key] = { css, js }
  }
  return { entry, exposes }
}

const BARE_SPECIFIER =
  /^(?:@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(?:\/[\w.@-]+)*$/i

/** Always the host's: never a fallback copy in a build (React, the router). */
export const NEVER_FALLBACK: readonly string[] = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'next/link',
  'next/navigation',
  'next/router',
]

/** An expose key as Module Federation writes it: './Name'. */
const isExposeKey = (key: unknown): key is string =>
  typeof key === 'string' && key.startsWith('./') && insidePath(key.slice(2))

function parseShared(
  value: unknown
): Record<string, ComponentSharedModule> | null {
  if (!isRecord(value)) return null
  const out: Record<string, ComponentSharedModule> = {}
  for (const [name, entry] of Object.entries(value)) {
    if (!BARE_SPECIFIER.test(name) || !isRecord(entry)) return null
    const { requiredVersion, fallback, exposes, version } = entry
    if (
      requiredVersion !== false &&
      (typeof requiredVersion !== 'string' || !isSemverRange(requiredVersion))
    ) {
      return null
    }
    if (typeof fallback !== 'boolean') return null
    if (fallback && NEVER_FALLBACK.includes(name)) return null
    if (
      exposes !== undefined &&
      (!Array.isArray(exposes) || !exposes.every(isExposeKey))
    ) {
      return null
    }
    if (
      version !== undefined &&
      (typeof version !== 'string' || !isSemverVersion(version))
    ) {
      return null
    }
    out[name] = {
      requiredVersion,
      fallback,
      ...(exposes === undefined ? {} : { exposes: [...exposes] }),
      ...(version === undefined ? {} : { version }),
    }
  }
  return out
}

/** The payload fields of a descriptor, validated; null when invalid. */
export function parseComponentBuildDescriptor(
  value: unknown
): ComponentBuildDescriptor | null {
  if (!isRecord(value) || value.v !== 1) return null
  const { name, buildId, manifest } = value
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) return null
  if (typeof buildId !== 'string' || !BUILD_ID_PATTERN.test(buildId))
    return null
  const base = absoluteBase(value.base)
  if (!base) return null
  if (typeof manifest !== 'string' || !manifest.startsWith(base)) return null
  if (!insidePath(manifest.slice(base.length))) return null
  let ssr: ComponentBuildDescriptor['ssr'] = null
  if (value.ssr !== null) {
    if (!isRecord(value.ssr)) return null
    const integrity = parseIntegrity(value.ssr.integrity)
    if (!integrity) return null
    ssr = { integrity }
  }
  const { iat } = value
  if (iat !== undefined && (!Number.isInteger(iat) || (iat as number) < 0)) {
    return null
  }
  let assets: ComponentBuildAssets | undefined
  if (value.assets !== undefined) {
    const parsed = parseAssets(value.assets, base)
    if (!parsed) return null
    assets = parsed
  }
  let shared: Record<string, ComponentSharedModule> | undefined
  if (value.shared !== undefined) {
    const parsed = parseShared(value.shared)
    if (!parsed) return null
    shared = parsed
  }
  return {
    v: 1,
    name,
    buildId,
    base,
    manifest,
    ssr,
    ...(iat === undefined ? {} : { iat: iat as number }),
    ...(assets === undefined ? {} : { assets }),
    ...(shared === undefined ? {} : { shared }),
  }
}

/** A published descriptor file, validated; null when invalid. */
export function parseComponentDescriptorFile(
  value: unknown
): ComponentDescriptorFile | null {
  const payload = parseComponentBuildDescriptor(value)
  if (!payload || !isRecord(value)) return null
  const { digest, jws } = value
  if (typeof digest !== 'string' || digest === '') return null
  if (jws !== undefined && typeof jws !== 'string') return null
  return jws === undefined
    ? { ...payload, digest }
    : { ...payload, digest, jws }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** `sha384-<base64>` (Subresource Integrity form) of `bytes`, via WebCrypto. */
export async function sha384Integrity(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-384',
    bytes as Uint8Array<ArrayBuffer>
  )
  return `sha384-${toBase64(new Uint8Array(digest))}`
}

/** The bytes a build signs and a pinned digest covers. */
export function componentDescriptorBytes(
  payload: ComponentBuildDescriptor
): Uint8Array {
  return new TextEncoder().encode(componentDescriptorCanonical(payload))
}

/** The canonical JSON of a descriptor's payload fields (what is signed and pinned). */
export function componentDescriptorCanonical(
  payload: ComponentBuildDescriptor
): string {
  const { v, name, buildId, base, manifest, ssr, iat, assets, shared } = payload
  return canonicalJson({
    v,
    name,
    buildId,
    base,
    manifest,
    ssr,
    iat,
    assets,
    shared,
  })
}

/** The descriptor digest a host pins: sha384 of the canonical payload. */
export function componentDescriptorDigest(
  payload: ComponentBuildDescriptor
): Promise<string> {
  return sha384Integrity(componentDescriptorBytes(payload))
}
