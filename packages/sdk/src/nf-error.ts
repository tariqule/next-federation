import { errorDocsUrl, formatError } from './error-codes.ts'
import type { NFErrorCode } from './error-codes.ts'

export class NFError extends Error {
  readonly code: NFErrorCode
  readonly docs: string

  constructor(
    code: NFErrorCode,
    detail?: string,
    options?: { cause?: unknown }
  ) {
    super(
      formatError(code, detail),
      options && 'cause' in options ? { cause: options.cause } : undefined
    )
    this.name = 'NFError'
    this.code = code
    this.docs = errorDocsUrl(code)
  }
}

/**
 * Duck-typed on `.code` so it still matches errors thrown by another copy of
 * this package (duplicate installs, separate bundles).
 */
export function isNFError(
  value: unknown,
  code?: NFErrorCode
): value is NFError {
  if (typeof value !== 'object' || value === null) return false
  const actual = (value as { code?: unknown }).code
  if (typeof actual !== 'string' || !/^NF-\d{3}$/.test(actual)) return false
  return code === undefined || actual === code
}
