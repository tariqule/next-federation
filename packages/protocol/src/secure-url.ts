// Plain http is accepted only where it cannot leak tokens or let a network
// attacker swap remote code: loopback hosts, development or test, or an
// explicit opt-in.
import { NFError, logger } from '@next-federation/sdk'

export type InsecureHttpOptions = {
  /** Accept http for any host (warned once per process). */
  allowInsecureHttp?: boolean
  /** Treat this as development. Default: NODE_ENV is "development" or "test". */
  development?: boolean
}

/** `localhost`, `127.0.0.0/8` or `[::1]`. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

/** Fails closed: anything but an explicit development or test environment. */
export function isDevelopmentOrTest(): boolean {
  try {
    const env = process.env.NODE_ENV
    return env === 'development' || env === 'test'
  } catch {
    return false
  }
}

/**
 * Throws NF-002 when `url` is plain http on a non-loopback host, unless the
 * environment is development or test or `allowInsecureHttp` is set. The
 * message names the URL's origin only (never credentials or the path).
 */
export function assertSecureUrl(
  url: URL,
  key: string,
  options: InsecureHttpOptions = {}
): void {
  if (url.protocol !== 'http:' || isLoopbackHost(url.hostname)) return
  if (options.development ?? isDevelopmentOrTest()) return
  if (options.allowInsecureHttp === true) {
    logger.warnOnce(
      'NF-002',
      'allowInsecureHttp',
      `\`allowInsecureHttp: true\` accepts plain http for non-loopback hosts (first: \`${key}\` ${url.origin}). Tokens and remote code travel unencrypted; use https in production.`
    )
    return
  }
  throw new NFError(
    'NF-002',
    `\`${key}\` must use https for a non-loopback host, got ${url.origin}. Plain http is accepted for localhost, 127.0.0.0/8 and [::1], when NODE_ENV is "development" or "test", or with \`allowInsecureHttp: true\`.`
  )
}

/** `options.allowInsecureHttp`, checked to be a boolean when present. */
export function parseAllowInsecureHttp(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw new NFError(
      'NF-002',
      `\`allowInsecureHttp\` must be a boolean, got ${JSON.stringify(value)}.`
    )
  }
  return value
}

/** `value` with any URL credentials replaced by `***`, for messages and logs. */
export function redactUrl(value: string): string {
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
