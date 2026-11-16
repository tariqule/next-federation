import { NAME_PATTERN } from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import { safeEmit } from './events.ts'
import type { FederationEvent } from './events.ts'

export type RemoteConfig = {
  origin: string
  assetOrigins?: string[]
  timeoutMs?: number
  retries?: number
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
    ttlSeconds?: number
  }
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

/** Never echo credentials from a rejected URL into messages or logs. */
function redact(value: string): string {
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      url.username = ''
      url.password = ''
      return url.href.replace('//', '//***@')
    }
    return value
  } catch {
    return value.replace(/\/\/[^/?#]*@/, '//***@')
  }
}

function parseUrl(value: unknown, key: string): URL {
  if (typeof value !== 'string') {
    throw invalid(`\`${key}\` must be an absolute http(s) URL string.`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalid(
      `\`${key}\` must be an absolute http(s) URL, got "${redact(value)}".`
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid(`\`${key}\` must use http or https, got "${redact(value)}".`)
  }
  return url
}

/** An origin: scheme and host only; a trailing slash is normalised away. */
function parseOrigin(value: unknown, key: string): string {
  const url = parseUrl(value, key)
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
      `\`${key}\` must be an origin without path, query or credentials, got "${redact(String(value))}".`
    )
  }
  return url.origin
}

export function defineFederation(config: FederationConfig): Federation {
  if (!isRecord(config) || !isRecord(config.remotes)) {
    throw invalid('`remotes` must be an object keyed by remote name.')
  }
  if (config.onEvent !== undefined && typeof config.onEvent !== 'function') {
    throw invalid('`onEvent` must be a function.')
  }

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
  for (const [name, remote] of Object.entries(config.remotes)) {
    if (!NAME_PATTERN.test(name)) {
      throw invalid(
        `remote name "${name}" in \`remotes\` must match ${String(NAME_PATTERN)}.`
      )
    }
    const where = `remotes.${name}`
    if (!isRecord(remote)) throw invalid(`\`${where}\` must be an object.`)
    const origin = parseOrigin(remote.origin, `${where}.origin`)
    let assetOrigins: string[] = []
    if (remote.assetOrigins !== undefined) {
      if (!Array.isArray(remote.assetOrigins)) {
        throw invalid(`\`${where}.assetOrigins\` must be an array of origins.`)
      }
      assetOrigins = remote.assetOrigins.map((value: unknown, i: number) =>
        parseOrigin(value, `${where}.assetOrigins[${i}]`)
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
  }

  let identity: Federation['identity'] = null
  if (config.identity !== undefined) {
    const raw: unknown = config.identity
    if (!isRecord(raw)) throw invalid('`identity` must be an object.')
    // The issuer is compared literally against the token `iss` claim, so it is
    // validated but kept exactly as written.
    parseUrl(raw.issuer, 'identity.issuer')
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
    identity = {
      issuer: raw.issuer as string,
      signingKeys: [...(keys as string[])],
      ttlSeconds: parseNumber(
        raw.ttlSeconds,
        'identity.ttlSeconds',
        DEFAULT_TTL_SECONDS
      ),
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

  return {
    remotes,
    target(remote) {
      const found = targets.get(remote)
      if (!found) {
        throw new NFError(
          'NF-001',
          `Remote "${remote}" is not in defineFederation().remotes (known: ${remotes.join(', ') || 'none'}).`
        )
      }
      return { ...found, allowedOrigins: [...found.allowedOrigins] }
    },
    islands: Object.freeze({ revalidate, warnBytes }),
    identity,
    routesPath,
    emit(event) {
      safeEmit(onEvent, event)
    },
  }
}
