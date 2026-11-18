// Remote components: fetch and verify a components remote's build descriptor.
// The host evaluates a remote's server code only for a build verified here;
// every other build renders in the browser only (secure by default).
import {
  COMPONENTS_JWS_TYPE,
  canonicalJson,
  componentDescriptorDigest,
  componentTrustRegistry,
  nowSeconds,
  parseComponentBuildDescriptor,
  verifiedKey,
  parseComponentDescriptorFile,
  sha384Integrity,
} from '@next-federation/protocol'
import type {
  ComponentBuildDescriptor,
  ComponentDescriptorFile,
  ComponentTrustKind,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'
import { DOCS_BASE } from '@next-federation/sdk'
import type { NFErrorCode } from '@next-federation/sdk'
import { compactVerify, decodeProtectedHeader, importJWK } from 'jose'
import type { ComponentPublicKey, ComponentTarget } from './config.ts'
import { readBodyLimited } from './read-body.ts'

export type { RemoteComponentDescriptor }
export { readBodyLimited }

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

/** A descriptor body larger than this is refused (NF-029). */
export const MAX_DESCRIPTOR_BYTES: number = 1024 * 1024

/** An HTML page, or a 404: the origin is probably not a components remote. */
function notAComponentsRemote(response: Response): boolean {
  const type = response.headers.get('content-type') ?? ''
  return response.status === 404 || /^\s*text\/html\b/i.test(type)
}

const NOT_A_COMPONENTS_REMOTE = ` The origin answered HTML / 404: is it a components remote (does it serve /_nf/components.json)? A Next.js app can't be a remote (see ${DOCS_BASE.replace(/\/errors\/$/, '/guides/')}sharing-components-from-a-next-app.md).`

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
  let hint = ''
  try {
    const response = await doFetch(target.descriptorUrl, {
      ...options.init,
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    })
    if (notAComponentsRemote(response)) hint = NOT_A_COMPONENTS_REMOTE
    if (!response.ok) {
      return fail(
        'NF-029',
        `${target.descriptorUrl} answered HTTP ${response.status}.${hint}`,
        response.status
      )
    }
    const bytes = await readBodyLimited(response, MAX_DESCRIPTOR_BYTES)
    if (!bytes) {
      return fail(
        'NF-029',
        `${target.descriptorUrl} is larger than ${MAX_DESCRIPTOR_BYTES} bytes.`
      )
    }
    text = new TextDecoder().decode(bytes)
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
    return fail('NF-029', `${target.descriptorUrl} is not JSON.${hint}`)
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

type TrustPolicy = NonNullable<ComponentTarget['ssr']>

/** How a descriptor was trusted, or why it was refused. */
export type DescriptorTrustResult =
  | { ok: true; trust: ComponentTrustKind }
  | { ok: false; code: 'NF-027' | 'NF-028'; detail: string }

/** The descriptor's payload fields (what is signed, pinned and digested). */
function payloadOf(file: ComponentDescriptorFile): ComponentBuildDescriptor {
  const { v, name, buildId, base, manifest, ssr, iat, assets, shared, types } =
    file
  return {
    v,
    name,
    buildId,
    base,
    manifest,
    ssr,
    ...(iat === undefined ? {} : { iat }),
    ...(assets === undefined ? {} : { assets }),
    ...(shared === undefined ? {} : { shared }),
    ...(types === undefined ? {} : { types }),
  }
}

/** The published digest must be the payload's, and the build time not ahead. */
function checkFile(
  target: ComponentTarget,
  file: ComponentDescriptorFile,
  digest: string
): Extract<DescriptorTrustResult, { ok: false }> | null {
  // A mismatch means the file was altered after the build (or hand-edited),
  // whatever else it carries.
  if (file.digest !== digest) {
    return {
      ok: false,
      code: 'NF-027',
      detail: `The descriptor of build "${file.buildId}" of remote "${target.remote}" carries a digest that is not its payload's.`,
    }
  }
  if (file.iat !== undefined && file.iat > nowSeconds() + FUTURE_IAT_SECONDS) {
    return {
      ok: false,
      code: 'NF-027',
      detail: `Build "${file.buildId}" of remote "${target.remote}" has a build time (iat) more than ${FUTURE_IAT_SECONDS} s in the future.`,
    }
  }
  return null
}

/** Signed by one of the policy's keys, pinned, or `unsafe-dev`; else refused. */
async function trustOf(
  target: ComponentTarget,
  policy: TrustPolicy,
  file: ComponentDescriptorFile,
  payload: ComponentBuildDescriptor,
  digest: string
): Promise<DescriptorTrustResult> {
  const { name, buildId, iat } = payload
  const refuse = (
    code: 'NF-027' | 'NF-028',
    detail: string
  ): DescriptorTrustResult => ({ ok: false, code, detail })
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
    return { ok: true, trust: 'signature' }
  }
  const pin = policy.pinned[buildId]
  if (pin !== undefined) {
    if (digest !== pin) {
      return refuse(
        'NF-027',
        `Build "${buildId}" of remote "${target.remote}" does not match its pinned digest.`
      )
    }
    return { ok: true, trust: 'pinned' }
  }
  if (policy.unsafeDev) return { ok: true, trust: 'unsafe-dev' }
  return refuse(
    'NF-028',
    `Build "${buildId}" of remote "${target.remote}" is neither signed by a configured key nor pinned, so its server code is not evaluated.`
  )
}

/**
 * Decides whether the host may evaluate this build's server code. Returns the
 * descriptor a component made with `createRemoteComponent` takes, with `ssr`
 * kept only for a verified build: a JWS from one of `ssr.publicKeys` whose
 * payload equals the descriptor, a `pinned` digest equal to the payload's, or
 * `unsafe-dev`.
 */
export async function verifyComponentDescriptor(
  target: ComponentTarget,
  file: ComponentDescriptorFile
): Promise<VerifiedComponentDescriptor> {
  const payload = payloadOf(file)
  const { name, buildId, base, manifest, iat, assets, shared, types } = payload
  const { jws } = file
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
    // Carried so a server can re-verify the descriptor (the digest covers it).
    ...(types === undefined ? {} : { types }),
  }
  // The browser renders an unverified build too, with its stylesheets.
  const browserOnly: RemoteComponentDescriptor =
    assets === undefined ? unstyled : { ...unstyled, assets }
  const digest = await componentDescriptorDigest(payload)
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
  const bad = checkFile(target, file, digest)
  if (bad) return refuse(bad.code, bad.detail)
  const policy = target.ssr
  if (!policy || !payload.ssr) return { descriptor: browserOnly, trust: null }
  const outcome = await trustOf(target, policy, file, payload, digest)
  if (!outcome.ok) return refuse(outcome.code, outcome.detail)
  // The server loader evaluates only descriptors recorded here (or that it
  // re-verifies itself from `jws` / a pin): `ssr` in a prop is never enough.
  // The kind matters: `ssr.maxAge` bounds signed builds only.
  componentTrustRegistry().verified.set(
    verifiedKey(target.remote, digest),
    outcome.trust
  )
  return {
    descriptor: {
      ...browserOnly,
      ssr: payload.ssr,
      ...(jws === undefined ? {} : { jws }),
    },
    trust: outcome.trust,
  }
}

/**
 * Whether a descriptor is what the remote built, by the remote's `ssr` trust
 * policy (a signature from one of its keys, a pinned digest or
 * `unsafe-dev`), whether or not the build has server code. For tools that
 * trust the descriptor's other data (its type declarations); records nothing
 * in the process trust registry. A remote with `ssr: false` has no policy, so
 * nothing it serves verifies (NF-028).
 */
export async function verifyDescriptorTrust(
  target: ComponentTarget,
  file: ComponentDescriptorFile
): Promise<DescriptorTrustResult> {
  const payload = payloadOf(file)
  const digest = await componentDescriptorDigest(payload)
  const bad = checkFile(target, file, digest)
  if (bad) return bad
  if (!target.ssr) {
    return {
      ok: false,
      code: 'NF-028',
      detail: `Remote "${target.remote}" has \`ssr: false\`, so no trust policy (publicKeys or pinned) verifies its descriptor.`,
    }
  }
  return trustOf(target, target.ssr, file, payload, digest)
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
  const verified = await verifyComponentDescriptor(target, result.file)
  return {
    ok: true,
    verified: await refuseUnloadableManifest(target, verified, options),
    ms: result.ms,
  }
}

/** Largest manifest the check reads (the server loader's own file limit). */
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024

/**
 * A verified build the server loader would refuse anyway, decided from its
 * verified Module Federation manifest before any render: one that lists
 * remotes of its own (their code would load outside the loader), has no
 * remotes list, or whose manifest is not JSON. It comes back browser-only
 * (NF-028), so the host never defers a static page waiting for it nor asks
 * the loader to load it. A manifest that cannot be fetched or does not match
 * its sha384 decides nothing: the loader verifies every file again.
 */
async function refuseUnloadableManifest(
  target: ComponentTarget,
  verified: VerifiedComponentDescriptor,
  options: FetchComponentDescriptorOptions
): Promise<VerifiedComponentDescriptor> {
  const { descriptor } = verified
  if (verified.trust === null || !descriptor.ssr) return verified
  const { base, manifest } = descriptor
  const expected = manifest.startsWith(base)
    ? descriptor.ssr.integrity[manifest.slice(base.length)]
    : undefined
  if (expected === undefined) return verified
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), target.timeoutMs)
  let body: Uint8Array | null
  try {
    const response = await (options.fetch ?? globalThis.fetch)(manifest, {
      ...options.init,
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) return verified
    body = await readBodyLimited(response, MAX_MANIFEST_BYTES)
  } catch (error) {
    if (error instanceof TypeError || controller.signal.aborted) {
      return verified
    }
    // Anything else (for example a framework control-flow error) propagates.
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (!body || (await sha384Integrity(body)) !== expected) return verified
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(body))
  } catch {
    parsed = null
  }
  const remotes =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { remotes?: unknown }).remotes
      : null
  let detail: string | null = null
  if (parsed === null || typeof parsed !== 'object') {
    detail = `The build at ${base} has no Module Federation manifest the server loader could check (nested remotes, plugin version), so its server code is not evaluated.`
  } else if (!Array.isArray(remotes)) {
    detail = `The manifest of the build at ${base} has no remotes list, so nested remotes cannot be ruled out and its server code is not evaluated.`
  } else if (remotes.length > 0) {
    detail = `The build at ${base} lists remotes of its own: their code would load outside the server loader (unverified, on the real global), so its server code is not evaluated.`
  }
  if (detail === null) return verified
  const browserOnly = { ...descriptor }
  delete browserOnly.jws
  return {
    descriptor: { ...browserOnly, ssr: null },
    trust: null,
    code: 'NF-028',
    detail,
  }
}
