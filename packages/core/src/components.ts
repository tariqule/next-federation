// Mode A: fetch and verify a components remote's build descriptor. The host
// evaluates a remote's server code only for a build verified here; every
// other build renders in the browser only (secure by default).
import {
  COMPONENTS_JWS_TYPE,
  canonicalJson,
  componentDescriptorDigest,
  componentTrustRegistry,
  nowSeconds,
  parseComponentBuildDescriptor,
  verifiedKey,
  parseComponentDescriptorFile,
} from '@next-federation/protocol'
import type {
  ComponentBuildDescriptor,
  ComponentDescriptorFile,
  ComponentTrustKind,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'
import type { NFErrorCode } from '@next-federation/sdk'
import { compactVerify, decodeProtectedHeader, importJWK } from 'jose'
import type { ComponentPublicKey, ComponentTarget } from './config.ts'

export type { RemoteComponentDescriptor }

export type ComponentDescriptorResult =
  | { ok: true; file: ComponentDescriptorFile; ms: number }
  | {
      ok: false
      code: 'NF-005' | 'NF-029'
      status?: number
      detail: string
      ms: number
    }

export type FetchComponentDescriptorOptions = {
  /** Injected; defaults to `globalThis.fetch`. */
  fetch?: typeof fetch
  /** Merged into the fetch call, e.g. `{ next: { revalidate } }` or `{ cache: 'no-store' }`. */
  init?: Record<string, unknown>
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null
    ? String((error as { name?: unknown }).name)
    : ''
}

/**
 * Fetches a remote's current build descriptor. Never throws for remote
 * failures (NF-029: HTTP error, timeout, bad JSON or shape; NF-005: a build
 * served from an origin outside the remote's origins). No wall-clock reads:
 * timing uses `performance.now()`.
 */
export async function fetchComponentDescriptor(
  target: ComponentTarget,
  options: FetchComponentDescriptorOptions = {}
): Promise<ComponentDescriptorResult> {
  const doFetch = options.fetch ?? globalThis.fetch
  const started = performance.now()
  const ms = (): number => Math.round(performance.now() - started)
  const fail = (
    code: 'NF-005' | 'NF-029',
    detail: string,
    status?: number
  ): ComponentDescriptorResult => ({
    ok: false,
    code,
    detail,
    ms: ms(),
    ...(status === undefined ? {} : { status }),
  })
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, target.timeoutMs)
  let text: string
  try {
    const response = await doFetch(target.descriptorUrl, {
      ...options.init,
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      return fail(
        'NF-029',
        `${target.descriptorUrl} answered HTTP ${response.status}.`,
        response.status
      )
    }
    text = await response.text()
  } catch (error) {
    if (
      timedOut ||
      errorName(error) === 'AbortError' ||
      errorName(error) === 'TimeoutError'
    ) {
      return fail(
        'NF-029',
        `${target.descriptorUrl} timed out after ${target.timeoutMs} ms.`
      )
    }
    if (error instanceof TypeError) {
      return fail(
        'NF-029',
        `${target.descriptorUrl} could not be fetched: ${error.message}`
      )
    }
    // Anything else (for example a framework control-flow error) propagates.
    throw error
  } finally {
    clearTimeout(timer)
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return fail('NF-029', `${target.descriptorUrl} is not JSON.`)
  }
  const file = parseComponentDescriptorFile(json)
  if (!file) {
    return fail(
      'NF-029',
      `${target.descriptorUrl} is not a v1 components descriptor.`
    )
  }
  if (!target.allowedOrigins.includes(new URL(file.base).origin)) {
    return fail(
      'NF-005',
      `Build "${file.buildId}" is served from ${new URL(file.base).origin}, outside remote "${target.remote}"'s origins.`
    )
  }
  return { ok: true, file, ms: ms() }
}

export type VerifiedComponentDescriptor = {
  descriptor: RemoteComponentDescriptor
  /** How the server code was trusted; null: browser-only. */
  trust: ComponentTrustKind | null
  /** Why SSR is off for this build (NF-027 integrity failure, NF-028 unverified). */
  code?: Extract<NFErrorCode, 'NF-027' | 'NF-028'>
  detail?: string
}

export { nowSeconds }

/** A build time further ahead than this is refused (clock skew allowance). */
const FUTURE_IAT_SECONDS = 60

function withinAge(iat: number | undefined, maxAgeSeconds: number): boolean {
  return iat !== undefined && nowSeconds() - iat <= maxAgeSeconds
}

const samePayload = (
  a: ComponentBuildDescriptor,
  b: ComponentBuildDescriptor
): boolean => canonicalJson(a) === canonicalJson(b)

async function verifySignature(
  jws: string,
  keys: ComponentPublicKey[]
): Promise<ComponentBuildDescriptor | null> {
  let kid: string | undefined
  try {
    const header = decodeProtectedHeader(jws)
    if (header.alg !== 'ES256' || header.typ !== COMPONENTS_JWS_TYPE) {
      return null
    }
    kid = header.kid
  } catch {
    return null
  }
  // Keys with the JWS kid first, then keys without a kid (rotation).
  const candidates = keys.filter(
    (k) => k.kid === undefined || kid === undefined || k.kid === kid
  )
  for (const key of candidates) {
    try {
      const { payload } = await compactVerify(
        jws,
        await importJWK({ ...key }, 'ES256'),
        { algorithms: ['ES256'] }
      )
      return parseComponentBuildDescriptor(
        JSON.parse(new TextDecoder().decode(payload)) as unknown
      )
    } catch {
      // Try the next key.
    }
  }
  return null
}

/**
 * Decides whether the host may evaluate this build's server code. Returns the
 * descriptor `RemoteComponent` takes, with `ssr` kept only for a verified
 * build: a JWS from one of `ssr.publicKeys` whose payload equals the
 * descriptor, a `pinned` digest equal to the payload's, or `unsafe-dev`.
 */
export async function verifyComponentDescriptor(
  target: ComponentTarget,
  file: ComponentDescriptorFile
): Promise<VerifiedComponentDescriptor> {
  const { v, name, buildId, base, manifest, ssr, iat, assets, shared, jws } =
    file
  const payload: ComponentBuildDescriptor = {
    v,
    name,
    buildId,
    base,
    manifest,
    ssr,
    ...(iat === undefined ? {} : { iat }),
    ...(assets === undefined ? {} : { assets }),
    ...(shared === undefined ? {} : { shared }),
  }
  // `shared` is kept even for a refused file: it names no URL, and the host
  // only uses it to refuse a load it could not satisfy (NF-036).
  const unstyled: RemoteComponentDescriptor = {
    remote: target.remote,
    name,
    buildId,
    base,
    manifest,
    ssr: null,
    maxBuilds: target.maxBuilds,
    ...(iat === undefined ? {} : { iat }),
    ...(shared === undefined ? {} : { shared }),
  }
  // The browser renders an unverified build too, with its stylesheets.
  const browserOnly: RemoteComponentDescriptor =
    assets === undefined ? unstyled : { ...unstyled, assets }
  const digest = await componentDescriptorDigest(payload)
  const trusted = (trust: ComponentTrustKind): VerifiedComponentDescriptor => {
    // The server loader evaluates only descriptors recorded here (or that it
    // re-verifies itself from `jws` / a pin): `ssr` in a prop is never enough.
    // The kind matters: `ssr.maxAge` bounds signed builds only.
    componentTrustRegistry().verified.set(
      verifiedKey(target.remote, digest),
      trust
    )
    return {
      descriptor: {
        ...browserOnly,
        ssr: payload.ssr,
        ...(jws === undefined ? {} : { jws }),
      },
      trust,
    }
  }
  const refuse = (
    code: 'NF-027' | 'NF-028',
    detail: string
  ): VerifiedComponentDescriptor => ({
    // NF-027: the file is not what was built, so none of its URLs are used
    // (no stylesheet or modulepreload link from a URL the remote didn't sign).
    descriptor: code === 'NF-027' ? unstyled : browserOnly,
    trust: null,
    code,
    detail,
  })
  // The published digest must be the payload's: a mismatch means the file
  // was altered after the build (or hand-edited), whatever else it carries.
  if (file.digest !== digest) {
    return refuse(
      'NF-027',
      `The descriptor of build "${buildId}" of remote "${target.remote}" carries a digest that is not its payload's.`
    )
  }
  if (iat !== undefined && iat > nowSeconds() + FUTURE_IAT_SECONDS) {
    return refuse(
      'NF-027',
      `Build "${buildId}" of remote "${target.remote}" has a build time (iat) more than ${FUTURE_IAT_SECONDS} s in the future.`
    )
  }
  const policy = target.ssr
  if (!policy || !payload.ssr) return { descriptor: browserOnly, trust: null }
  if (target.name !== null && name !== target.name) {
    return refuse(
      'NF-027',
      `Build "${buildId}" names container "${name}", but remote "${target.remote}" expects "${target.name}".`
    )
  }

  if (file.jws !== undefined && policy.publicKeys.length > 0) {
    const signed = await verifySignature(file.jws, policy.publicKeys)
    if (!signed) {
      return refuse(
        'NF-027',
        `The descriptor of build "${buildId}" of remote "${target.remote}" is not signed by any configured public key.`
      )
    }
    if (!samePayload(signed, payload)) {
      return refuse(
        'NF-027',
        `The descriptor of build "${buildId}" of remote "${target.remote}" differs from its signed payload.`
      )
    }
    if (
      policy.maxAgeSeconds !== null &&
      !withinAge(iat, policy.maxAgeSeconds)
    ) {
      return refuse(
        'NF-027',
        `Build "${buildId}" of remote "${target.remote}" was signed ${iat === undefined ? 'without a build time' : 'too long ago'} (ssr.maxAge ${policy.maxAgeSeconds} s).`
      )
    }
    return trusted('signature')
  }
  const pin = policy.pinned[buildId]
  if (pin !== undefined) {
    if (digest !== pin) {
      return refuse(
        'NF-027',
        `Build "${buildId}" of remote "${target.remote}" does not match its pinned digest.`
      )
    }
    return trusted('pinned')
  }
  if (policy.unsafeDev) return trusted('unsafe-dev')
  return refuse(
    'NF-028',
    `Build "${buildId}" of remote "${target.remote}" is neither signed by a configured key nor pinned, so its server code is not evaluated.`
  )
}

export type VerifiedDescriptorResult =
  | { ok: true; verified: VerifiedComponentDescriptor; ms: number }
  | Extract<ComponentDescriptorResult, { ok: false }>

/**
 * `fetchComponentDescriptor` then `verifyComponentDescriptor`, as one plain
 * result. Adapters cache this whole result: verification uses WebCrypto,
 * whose async work a cacheComponents prerender would otherwise see as
 * uncached I/O (and turn the component into a dynamic hole).
 */
export async function fetchVerifiedComponentDescriptor(
  target: ComponentTarget,
  options: FetchComponentDescriptorOptions = {}
): Promise<VerifiedDescriptorResult> {
  const result = await fetchComponentDescriptor(target, options)
  if (!result.ok) return result
  return {
    ok: true,
    verified: await verifyComponentDescriptor(target, result.file),
    ms: result.ms,
  }
}
