import { formatError } from './error-codes.ts'
import type { NFErrorCode } from './error-codes.ts'

export type LogSink = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>

export type Logger = {
  debug(...a: unknown[]): void
  info(...a: unknown[]): void
  warn(code: NFErrorCode, detail?: string): void
  error(code: NFErrorCode, detail?: string, cause?: unknown): void
  warnOnce(code: NFErrorCode, key: string, detail?: string): void
}

function debugEnabled(): boolean {
  if (typeof process === 'undefined') return false
  const value = process.env?.NF_DEBUG
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v !== '0' && v !== 'false'
}

export function createLogger(prefix: string, sink: LogSink = console): Logger {
  const seen = new Set<string>()
  return {
    debug(...a) {
      if (debugEnabled()) sink.debug(prefix, ...a)
    },
    info(...a) {
      sink.info(prefix, ...a)
    },
    warn(code, detail) {
      sink.warn(prefix, formatError(code, detail))
    },
    error(code, detail, cause) {
      const message = formatError(code, detail)
      if (cause === undefined) sink.error(prefix, message)
      else sink.error(prefix, message, cause)
    },
    warnOnce(code, key, detail) {
      const id = `${code}:${key}`
      if (seen.has(id)) return
      seen.add(id)
      sink.warn(prefix, formatError(code, detail))
    },
  }
}

export const logger: Logger = createLogger('[ next-federation ]')
