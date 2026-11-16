import {
  BUILD_ID_PATTERN,
  NAME_PATTERN,
  SHA384_PATTERN,
  assertSecureUrl,
  componentTrustRegistry,
  isDevelopmentOrTest,
  parseAllowInsecureHttp,
  redactUrl,
  verifiedKey,
} from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import { safeEmit } from './events.ts'
import type { FederationEvent } from './events.ts'

export type RemoteConfig = {
  origin: string
  assetOrigins?: string[]
  timeoutMs?: number
  retries?: number
  /** Mode A: this remote also serves Module Federation client components. */
  components?: RemoteComponentsConfig
}

/** A public EC P-256 JWK (`kty`, `crv`, `x`, `y`, optional `kid`). */
export type ComponentPublicKey = {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
  kid?: string
}

export type RemoteComponentsConfig = {
  /** Descriptor URL. Default `${origin}/_nf/components.json`. */
  descriptor?: string
  /** Seconds the host caches the descriptor. Default `islands.revalidate`. */
  revalidate?: number
  /** Distinct builds of this remote a process keeps loaded. Default 5. */
  maxBuilds?: number
  /**
   * Server rendering. The host evaluates the remote's server code only for a
   * build it can verify: a descriptor signed by one of `publicKeys`, or a
   * `pinned` buildId -> digest pair; `integrity: 'unsafe-dev'` (not in
   * production) trusts the descriptor as served. Anything else renders in the
   * browser only. `false`: never server-render this remote.
   */
  ssr?:
    | false
    | {
        publicKeys?: ComponentPublicKey[]
        pinned?: Record<string, string>
        integrity?: 'unsafe-dev'
        /** Seconds a signed build stays acceptable after its build time (`iat`). */
        maxAge?: number
      }
  /** The expected Module Federation container name; a descriptor naming another is refused. */
  name?: string
}

/** Plain, serializable description of a components remote: safe as a 'use cache' argument. */
export type ComponentTarget = {
  remote: string
  descriptorUrl: string
  allowedOrigins: string[]
  timeoutMs: number
  revalidate: number
  maxBuilds: number
  /** The expected container name, or null. */
  name: string | null
  ssr: null | {
    publicKeys: ComponentPublicKey[]
    pinned: Record<string, string>
    unsafeDev: boolean
    /** Seconds a signed build stays acceptable after its `iat`, or null. */
    maxAgeSeconds: number | null
  }
}

export type FederationConfig = {
  remotes: Record<string, RemoteConfig>
  islands?: {
    revalidate?: number
    timeoutMs?: number
    retries?: number
    warnBytes?: number
  }
  identity?: {
    issuer: string
    signingKeys: string | string[]
    /** Token lifetime in seconds. Default 300, at most 900 (remotes refuse older tokens). */
    ttlSeconds?: number
  }
  /**
   * Accept plain `http:` remote origins, asset origins and issuer for
   * non-loopback hosts outside development (warned once per process).
   * Default false: http is accepted only for localhost, 127.0.0.0/8 and
   * [::1], or when NODE_ENV is "development" or "test".
   */
  allowInsecureHttp?: boolean
  /** Default `/api/next-federation`. */
  routesPath?: string
  /**
   * Observer for island events. It must not throw: if it does, the error is
   * caught and logged with `logger.debug` (no error code) and never reaches
   * the caller.
   */
  onEvent?: (event: FederationEvent) => void
}

/** Plain, serializable description of one remote: safe as a 'use cache' argument. */
export type IslandTarget = {
  remote: string
  origin: string
  allowedOrigins: string[]
  timeoutMs: number
  retries: number
}

export type Federation = {
  readonly remotes: readonly string[]
  /** Throws NF-001 when the remote is unknown. */
  target(remote: string): IslandTarget
  /** Throws NF-001 when the remote is unknown, NF-002 when it has no `components`. */
  componentTarget(remote: string): ComponentTarget
  readonly islands: { revalidate: number; warnBytes: number }
  readonly identity: {
    issuer: string
    signingKeys: string[]
    ttlSeconds: number
  } | null
  readonly routesPath: string
  /** Never throws; a throwing `onEvent` is logged with `logger.debug` and swallowed. */
  emit(event: FederationEvent): void
}

const DEFAULT_TIMEOUT_MS = 3000
const DEFAULT_RETRIES = 1
const DEFAULT_REVALIDATE = 60
const DEFAULT_WARN_BYTES = 102400
const DEFAULT_TTL_SECONDS = 300
/** Remotes refuse tokens older than 900 s (`createIdentityVerifier` default). */
const MAX_TTL_SECONDS = 900
const DEFAULT_ROUTES_PATH = '/api/next-federation'

function invalid(detail: string): NFError {
  return new NFError('NF-002', detail)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseNumber(value: unknown, key: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalid(
      `\`${key}\` must be a finite number >= 0, got ${String(value)}.`
    )
  }
  return value
}

function parseUrl(
  value: unknown,
  key: string,
  allowInsecureHttp: boolean
): URL {
  if (typeof value !== 'string') {
    throw invalid(`\`${key}\` must be an absolute http(s) URL string.`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalid(
      `\`${key}\` must be an absolute http(s) URL, got "${redactUrl(value)}".`
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid(
      `\`${key}\` must use http or https, got "${redactUrl(value)}".`
    )
  }
  assertSecureUrl(url, key, { allowInsecureHttp })
  return url
}

/** An origin: scheme and host only; a trailing slash is normalised away. */
function parseOrigin(
  value: unknown,
  key: string,
  allowInsecureHttp: boolean
): string {
  const url = parseUrl(value, key, allowInsecureHttp)
  // `new URL` drops an empty query or fragment, so the raw string is checked too.
  const hasExtra =
    String(value).includes('?') ||
    String(value).includes('#') ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  if (hasExtra) {
    throw invalid(
      `\`${key}\` must be an origin without path, query or credentials, got "${redactUrl(String(value))}".`
    )
  }
  return url.origin
}

const DEFAULT_MAX_BUILDS = 5

function parsePublicKey(value: unknown, key: string): ComponentPublicKey {
  if (
    !isRecord(value) ||
    value.kty !== 'EC' ||
    value.crv !== 'P-256' ||
    typeof value.x !== 'string' ||
    typeof value.y !== 'string' ||
    'd' in value ||
    (value.kid !== undefined && typeof value.kid !== 'string')
  ) {
    throw invalid(
      `\`${key}\` must be a public EC P-256 JWK ({ kty: 'EC', crv: 'P-256', x, y, kid? }) without "d".`
    )
  }
  const { kty, crv, x, y, kid } = value as ComponentPublicKey
  return kid === undefined ? { kty, crv, x, y } : { kty, crv, x, y, kid }
}

function parseComponents(
  value: unknown,
  ctx: {
    where: string
    remote: string
    origin: string
    allowedOrigins: string[]
    timeoutMs: number
    revalidate: number
    allowInsecureHttp: boolean
  }
): ComponentTarget {
  const { where } = ctx
  if (!isRecord(value)) throw invalid(`\`${where}\` must be an object.`)
  let descriptorUrl = `${ctx.origin}/_nf/components.json`
  if (value.descriptor !== undefined) {
    const url = parseUrl(
      value.descriptor,
      `${where}.descriptor`,
      ctx.allowInsecureHttp
    )
    if (!ctx.allowedOrigins.includes(url.origin)) {
      throw invalid(
        `\`${where}.descriptor\` must be on the remote's origin or assetOrigins, got "${redactUrl(url.href)}".`
      )
    }
    descriptorUrl = url.href
  }
  const maxBuilds = parseNumber(
    value.maxBuilds,
    `${where}.maxBuilds`,
    DEFAULT_MAX_BUILDS
  )
  if (!Number.isInteger(maxBuilds) || maxBuilds < 1) {
    throw invalid(`\`${where}.maxBuilds\` must be an integer >= 1.`)
  }
  let ssr: ComponentTarget['ssr']
  if (value.ssr === false) {
    ssr = null
  } else {
    const raw = value.ssr ?? {}
    if (!isRecord(raw)) {
      throw invalid(`\`${where}.ssr\` must be false or an object.`)
    }
    const keys = raw.publicKeys ?? []
    if (!Array.isArray(keys)) {
      throw invalid(`\`${where}.ssr.publicKeys\` must be an array of JWKs.`)
    }
    const pinnedRaw = raw.pinned ?? {}
    if (!isRecord(pinnedRaw)) {
      throw invalid(
        `\`${where}.ssr.pinned\` must map buildIds to sha384 digests.`
      )
    }
    const pinned: Record<string, string> = {}
    for (const [buildId, digest] of Object.entries(pinnedRaw)) {
      if (
        !BUILD_ID_PATTERN.test(buildId) ||
        typeof digest !== 'string' ||
        !SHA384_PATTERN.test(digest)
      ) {
        throw invalid(
          `\`${where}.ssr.pinned\` must map buildIds to "sha384-..." digests, got ${JSON.stringify(buildId)}.`
        )
      }
      pinned[buildId] = digest
    }
    if (raw.integrity !== undefined && raw.integrity !== 'unsafe-dev') {
      throw invalid(
        `\`${where}.ssr.integrity\` can only be 'unsafe-dev', got ${JSON.stringify(raw.integrity)}.`
      )
    }
    const unsafeDev = raw.integrity === 'unsafe-dev'
    if (unsafeDev && !isDevelopmentOrTest()) {
      throw invalid(
        `\`${where}.ssr.integrity: 'unsafe-dev'\` runs unverified remote code on the server and is allowed only when NODE_ENV is "development" or "test". Sign the remote's descriptor (publicKeys) or pin its builds (pinned).`
      )
    }
    let maxAgeSeconds: number | null = null
    if (raw.maxAge !== undefined) {
      maxAgeSeconds = parseNumber(raw.maxAge, `${where}.ssr.maxAge`, 0)
      if (maxAgeSeconds <= 0) {
        throw invalid(
          `\`${where}.ssr.maxAge\` must be a number of seconds > 0.`
        )
      }
    }
    ssr = {
      publicKeys: keys.map((k: unknown, i: number) =>
        parsePublicKey(k, `${where}.ssr.publicKeys[${i}]`)
      ),
      pinned,
      unsafeDev,
      maxAgeSeconds,
    }
  }
  return {
    remote: ctx.remote,
    descriptorUrl,
    allowedOrigins: [...ctx.allowedOrigins],
    timeoutMs: ctx.timeoutMs,
    revalidate: parseNumber(
      value.revalidate,
      `${where}.revalidate`,
      ctx.revalidate
    ),
    maxBuilds,
    name: parseContainerName(value.name, `${where}.name`),
    ssr,
  }
}

function parseContainerName(value: unknown, key: string): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string' || !NAME_PATTERN.test(value)) {
    throw invalid(`\`${key}\` must match ${String(NAME_PATTERN)}.`)
  }
  return value
}

/**
 * Server only: publish each remote's trust policy to the process-wide
 * registry the server loader re-verifies descriptors against.
 */
function registerTrust(target: ComponentTarget): void {
  if ((globalThis as { window?: unknown }).window) return
  const registry = componentTrustRegistry()
  const policy = target.ssr && {
    publicKeys: target.ssr.publicKeys.map((k) => ({ ...k })),
    pinned: { ...target.ssr.pinned },
    unsafeDev: target.ssr.unsafeDev,
    maxAgeSeconds: target.ssr.maxAgeSeconds,
    name: target.name,
    allowedOrigins: [...target.allowedOrigins],
  }
  const before = registry.trust.get(target.remote)
  if (JSON.stringify(before ?? null) === JSON.stringify(policy && [policy])) {
    return // the same policy (another bundle layer evaluating the config)
  }
  // Replaced, never appended: a dev reload must drop removed keys and
  // unsafe-dev, and the builds verified under the old policy.
  const prefix = verifiedKey(target.remote, '')
  for (const key of registry.verified.keys()) {
    if (key.startsWith(prefix)) registry.verified.delete(key)
  }
  if (policy) registry.trust.set(target.remote, [policy])
  else registry.trust.delete(target.remote)
}

export function defineFederation(config: FederationConfig): Federation {
  if (!isRecord(config) || !isRecord(config.remotes)) {
    throw invalid('`remotes` must be an object keyed by remote name.')
  }
  if (config.onEvent !== undefined && typeof config.onEvent !== 'function') {
    throw invalid('`onEvent` must be a function.')
  }

  const allowInsecureHttp = parseAllowInsecureHttp(config.allowInsecureHttp)
  const islandsIn = config.islands ?? {}
  if (!isRecord(islandsIn)) throw invalid('`islands` must be an object.')
  const revalidate = parseNumber(
    islandsIn.revalidate,
    'islands.revalidate',
    DEFAULT_REVALIDATE
  )
  const warnBytes = parseNumber(
    islandsIn.warnBytes,
    'islands.warnBytes',
    DEFAULT_WARN_BYTES
  )
  const defaultTimeout = parseNumber(
    islandsIn.timeoutMs,
    'islands.timeoutMs',
    DEFAULT_TIMEOUT_MS
  )
  const defaultRetries = parseNumber(
    islandsIn.retries,
    'islands.retries',
    DEFAULT_RETRIES
  )

  const targets = new Map<string, IslandTarget>()
  const componentTargets = new Map<string, ComponentTarget>()
  for (const [name, remote] of Object.entries(config.remotes)) {
    if (!NAME_PATTERN.test(name)) {
      throw invalid(
        `remote name "${name}" in \`remotes\` must match ${String(NAME_PATTERN)}.`
      )
    }
    const where = `remotes.${name}`
    if (!isRecord(remote)) throw invalid(`\`${where}\` must be an object.`)
    const origin = parseOrigin(
      remote.origin,
      `${where}.origin`,
      allowInsecureHttp
    )
    let assetOrigins: string[] = []
    if (remote.assetOrigins !== undefined) {
      if (!Array.isArray(remote.assetOrigins)) {
        throw invalid(`\`${where}.assetOrigins\` must be an array of origins.`)
      }
      assetOrigins = remote.assetOrigins.map((value: unknown, i: number) =>
        parseOrigin(value, `${where}.assetOrigins[${i}]`, allowInsecureHttp)
      )
    }
    targets.set(name, {
      remote: name,
      origin,
      allowedOrigins: [...new Set([origin, ...assetOrigins])],
      timeoutMs: parseNumber(
        remote.timeoutMs,
        `${where}.timeoutMs`,
        defaultTimeout
      ),
      retries: parseNumber(remote.retries, `${where}.retries`, defaultRetries),
    })
    if (remote.components !== undefined) {
      const componentTarget = parseComponents(remote.components, {
        where: `${where}.components`,
        remote: name,
        origin,
        allowedOrigins: targets.get(name)!.allowedOrigins,
        timeoutMs: targets.get(name)!.timeoutMs,
        revalidate,
        allowInsecureHttp,
      })
      componentTargets.set(name, componentTarget)
      registerTrust(componentTarget)
    }
  }

  let identity: Federation['identity'] = null
  if (config.identity !== undefined) {
    const raw: unknown = config.identity
    if (!isRecord(raw)) throw invalid('`identity` must be an object.')
    // The issuer is compared literally against the token `iss` claim, so it is
    // validated but kept exactly as written.
    parseUrl(raw.issuer, 'identity.issuer', allowInsecureHttp)
    const keys =
      typeof raw.signingKeys === 'string' ? [raw.signingKeys] : raw.signingKeys
    if (
      !Array.isArray(keys) ||
      keys.length === 0 ||
      !keys.every((k) => typeof k === 'string' && k.length > 0)
    ) {
      throw invalid(
        '`identity.signingKeys` must be a non-empty string or array of non-empty strings.'
      )
    }
    const ttlSeconds = parseNumber(
      raw.ttlSeconds,
      'identity.ttlSeconds',
      DEFAULT_TTL_SECONDS
    )
    if (ttlSeconds > MAX_TTL_SECONDS) {
      throw invalid(
        `\`identity.ttlSeconds\` must be at most ${MAX_TTL_SECONDS} (remotes refuse tokens older than that), got ${ttlSeconds}.`
      )
    }
    identity = {
      issuer: raw.issuer as string,
      signingKeys: [...(keys as string[])],
      ttlSeconds,
    }
  }

  const routesPath = config.routesPath ?? DEFAULT_ROUTES_PATH
  if (typeof routesPath !== 'string' || !routesPath.startsWith('/')) {
    throw invalid(
      `\`routesPath\` must start with "/", got "${String(routesPath)}".`
    )
  }

  const remotes = Object.freeze([...targets.keys()])
  const onEvent = config.onEvent
  const unknownRemote = (remote: string): NFError =>
    new NFError(
      'NF-001',
      `Remote "${remote}" is not in defineFederation().remotes (known: ${remotes.join(', ') || 'none'}).`
    )

  return {
    remotes,
    target(remote) {
      const found = targets.get(remote)
      if (!found) throw unknownRemote(remote)
      return { ...found, allowedOrigins: [...found.allowedOrigins] }
    },
    componentTarget(remote) {
      const found = componentTargets.get(remote)
      if (!found) {
        if (!targets.has(remote)) throw unknownRemote(remote)
        throw invalid(
          `Remote "${remote}" has no \`components\` settings in defineFederation().remotes.`
        )
      }
      return structuredClone(found)
    },
    islands: Object.freeze({ revalidate, warnBytes }),
    identity,
    routesPath,
    emit(event) {
      safeEmit(onEvent, event)
    },
  }
}
