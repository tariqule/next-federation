// What a server preload of one remote component settled to, and how each
// recorded load outcome maps to it.
import type { NFErrorCode } from '@next-federation/sdk'
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

/** Why one server load settled as it did, recorded when it settles. */
export type ServerLoadOutcome =
  | { kind: 'loaded' }
  | { kind: 'blocked'; block: ServerBlock; code: NFErrorCode }
  | { kind: 'error'; code: NFErrorCode; error: unknown }

export function classifyOutcome(outcome: ServerLoadOutcome): {
  state: 'ready' | 'browser-only' | 'refused' | 'failed'
  code?: NFErrorCode
} {
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
