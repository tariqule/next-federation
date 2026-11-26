// What a server preload of one remote component settled to, and how each
// recorded load outcome maps to it.
import type {
  ComponentRefusalCode,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'
import { isNFError } from '@next-federation/sdk'
import type { NFError, NFErrorCode } from '@next-federation/sdk'
import type { ServerBlock } from './runtime.ts'

export type PreloadState =
  | 'ready'
  | 'browser-only'
  | 'refused'
  | 'failed'
  | 'timeout'
  | 'no-descriptor'

export type PreloadResult =
  | { state: 'no-descriptor'; ms: number }
  | {
      state: 'ready' | 'timeout'
      remote: string
      buildId: string
      expose: string
      ms: number
    }
  | {
      state: 'browser-only' | 'refused' | 'failed'
      remote: string
      buildId: string
      expose: string
      ms: number
      code: NFErrorCode
    }

export type PreloadOptions = { timeoutMs: number }

/**
 * `preloadRemoteComponent`: without options it resolves once the load
 * settles; with options it says how the load settled. Never rejects.
 */
export type PreloadRemoteComponent = {
  (descriptor: RemoteComponentDescriptor | null, expose: string): Promise<void>
  (
    descriptor: RemoteComponentDescriptor | null,
    expose: string,
    options: PreloadOptions
  ): Promise<PreloadResult>
  (
    descriptor: RemoteComponentDescriptor | null,
    expose: string,
    options?: PreloadOptions
  ): Promise<void | PreloadResult>
}

/** Why one server load settled as it did, recorded when it settles. */
export type ServerLoadOutcome =
  | { kind: 'loaded' }
  | { kind: 'blocked'; block: ServerBlock; code: ComponentRefusalCode }
  | { kind: 'error'; code: NFErrorCode; error: unknown }

export type ClassifiedOutcome =
  | { state: 'ready'; code?: undefined }
  | { state: 'refused'; code: ComponentRefusalCode }
  | { state: 'browser-only' | 'failed'; code: NFErrorCode }

export function classifyOutcome(outcome: ServerLoadOutcome): ClassifiedOutcome {
  switch (outcome.kind) {
    case 'loaded':
      return { state: 'ready' }
    case 'blocked':
      switch (outcome.block) {
        // Code from other remotes, or a manifest the loader cannot check:
        // never loaded by this boundary.
        case 'nested-remotes':
        case 'unchecked':
          return { state: 'refused', code: outcome.code }
        default:
          return { state: 'browser-only', code: outcome.code }
      }
    case 'error':
      // An NF-028 load error is the loader declining server code here (the
      // browser may still load it): browser-only. A build the loader refused
      // outright is recorded as an NF-028 block above: refused.
      switch (outcome.code) {
        case 'NF-027':
        case 'NF-036':
          return { state: 'refused', code: outcome.code }
        case 'NF-030':
        case 'NF-028':
          return { state: 'browser-only', code: outcome.code }
        default:
          return { state: 'failed', code: outcome.code }
      }
  }
}

/**
 * The NF code of a rejected load. An unmet shared module (NF-036) keeps its
 * own code under the NF-028 wrapping of a build the loader refused.
 */
export function loadErrorCode(error: unknown): NFErrorCode {
  if (!isNFError(error)) return 'NF-029'
  const { code, cause } = error as NFError
  if (
    code === 'NF-028' &&
    isNFError(cause) &&
    (cause as NFError).code === 'NF-036'
  ) {
    return 'NF-036'
  }
  return code
}

/**
 * Browser: how one rejected load settled. A build the runtime knows is
 * refused (descriptor, server marker, or an earlier refusal on this page) is
 * refused with that code; otherwise as the server classifies the error,
 * except that nothing is left to fall back to: browser-only becomes failed.
 */
export function classifyClientError(
  error: unknown,
  refusedCode: ComponentRefusalCode | undefined
):
  | { state: 'refused'; code: ComponentRefusalCode }
  | {
      state: 'failed'
      code: NFErrorCode
    } {
  if (refusedCode) return { state: 'refused', code: refusedCode }
  const code = loadErrorCode(error)
  const settled = classifyOutcome({ kind: 'error', code, error })
  return settled.state === 'refused' ? settled : { state: 'failed', code }
}
