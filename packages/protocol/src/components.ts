// Mode A (Module Federation client components) wire format v1: the build
// descriptor a components remote publishes for each build. Bundler-neutral.
import { BUILD_ID_PATTERN, NAME_PATTERN, SHA384_PATTERN } from './constants.ts'
import { canonicalJson } from './props.ts'

/** The current build's descriptor; `/b/<buildId>/nf-components.json` names one build. */
export const COMPONENTS_DESCRIPTOR_PATH = '/_nf/components.json'
/** File name of a build's descriptor, in the build folder and under its base. */
export const COMPONENTS_DESCRIPTOR_FILE = 'nf-components.json'
/** The JWS `typ` header of a signed descriptor. */
export const COMPONENTS_JWS_TYPE = 'nf-components+jws'

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
  return iat === undefined
    ? { v: 1, name, buildId, base, manifest, ssr }
    : { v: 1, name, buildId, base, manifest, ssr, iat: iat as number }
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
  const { v, name, buildId, base, manifest, ssr, iat } = payload
  return canonicalJson({ v, name, buildId, base, manifest, ssr, iat })
}

/** The descriptor digest a host pins: sha384 of the canonical payload. */
export function componentDescriptorDigest(
  payload: ComponentBuildDescriptor
): Promise<string> {
  return sha384Integrity(componentDescriptorBytes(payload))
}
