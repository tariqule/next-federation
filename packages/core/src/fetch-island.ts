import {
  assertEnvelopeUrls,
  encodeIslandRequest,
  parseEnvelope,
} from '@next-federation/protocol'
import type { HostContext, IslandEnvelope } from '@next-federation/protocol'
import { DOCS_BASE, NFError, isNFError } from '@next-federation/sdk'
import type { IslandTarget } from './config.ts'
import type { FederationEvent } from './events.ts'
import { readBodyLimited } from './read-body.ts'

export type IslandFetchMeta = { ms: number; bytes: number; attempts: number }

export type IslandFailureCode =
  | 'NF-003'
  | 'NF-004'
  | 'NF-005'
  | 'NF-007'
  | 'NF-008'

/**
 * Why a failed origin is probably not an island remote: it answered an HTML
 * page, or a 404 that is not the protocol's JSON (a website, a Next.js app).
 */
export type IslandFailureHint = 'not-an-island-remote'

export type IslandResult =
  | { ok: true; envelope: IslandEnvelope; meta: IslandFetchMeta }
  | {
      ok: false
      code: IslandFailureCode
      status?: number
      /** The island URL, without its query (props, host context). */
      url?: string
      hint?: IslandFailureHint
      meta: IslandFetchMeta
    }

export type FetchIslandRequest = {
  island: string
  props?: unknown
  host?: HostContext
  token?: string
  /** Injected; defaults to `globalThis.fetch`. */
  fetch?: typeof fetch
  /** Merged into every fetch call, e.g. `{ next: { revalidate, tags } }` or `{ cache: 'no-store' }`. */
  init?: Record<string, unknown>
}

/**
 * Default ceiling for an island response body (`islands.maxBytes`). Envelopes
 * are usually a few KB (the host warns above `islands.warnBytes`, 100 KB); the
 * ceiling only stops a remote from making the host buffer an unbounded body.
 */
export const MAX_ENVELOPE_BYTES: number = 5 * 1024 * 1024

const RETRY_DELAY_MS = 100
const RETRYABLE_STATUS = new Set([502, 503, 504])

/** Cache tags for an island fetch: the remote, and the island when given. */
export function islandTags(remote: string, island?: string): string[] {
  return island === undefined
    ? [`nf:${remote}`]
    : [`nf:${remote}`, `nf:${remote}:${island}`]
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null
    ? String((error as { name?: unknown }).name)
    : ''
}

function isRedirectError(error: Error): boolean {
  const cause = (error as { cause?: unknown }).cause
  const causeMessage =
    typeof cause === 'object' && cause !== null
      ? String((cause as { message?: unknown }).message)
      : ''
  return /redirect/i.test(error.message) || /redirect/i.test(causeMessage)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Failure = {
  code: IslandFailureCode
  status?: number
  hint?: IslandFailureHint
  retry: boolean
}

/** An HTML page, or a 404 without the protocol's JSON error body. */
function notAnIslandRemote(response: Response): boolean {
  const type = response.headers.get('content-type') ?? ''
  if (/^\s*text\/html\b/i.test(type)) return true
  return response.status === 404 && !/^\s*application\/json\b/i.test(type)
}

const GUIDES = DOCS_BASE.replace(/\/errors\/$/, '/guides/')

/**
 * The failure's detail for a log line: its URL (never its query, where the
 * props are), its HTTP status, and a hint when the origin does not look like
 * an island remote. Empty for a success.
 */
export function islandFailureDetail(result: IslandResult): string {
  if (result.ok) return ''
  const status = result.status === undefined ? '' : ` (HTTP ${result.status})`
  const at = result.url === undefined ? '' : `at ${result.url}`
  const hint =
    result.hint === 'not-an-island-remote'
      ? `; the origin answered HTML / 404: is it an island remote (does it serve /_nf/island)? A Next.js app can't be a remote (see ${GUIDES}remote-components/sharing-from-a-next-app.mdx)`
      : ''
  return `${at}${status}${hint}`.trim()
}

export async function fetchIsland(
  target: IslandTarget,
  request: FetchIslandRequest
): Promise<IslandResult> {
  // Caller mistakes (bad island name NF-002, props not JSON NF-009) throw here.
  const encoded = encodeIslandRequest(
    target.origin,
    request.island,
    request.props,
    { token: request.token, host: request.host }
  )
  const doFetch = request.fetch ?? globalThis.fetch
  // performance.now(), not Date.now(): Next aborts cacheComponents prerenders
  // that read the wall clock outside a cache scope, which would turn a
  // `no-store` island into a build error instead of a dynamic hole.
  const started = performance.now()
  const elapsed = (): number => Math.round(performance.now() - started)
  let attempts = 0
  let bytes = 0
  const meta = (): IslandFetchMeta => ({ ms: elapsed(), bytes, attempts })
  // Origin and path only: the query holds the props and host context.
  const at = new URL(encoded.url)
  const url = `${at.origin}${at.pathname}`
  const fail = (f: Failure): IslandResult => ({
    ok: false,
    code: f.code,
    ...(f.status === undefined ? {} : { status: f.status }),
    url,
    ...(f.hint === undefined ? {} : { hint: f.hint }),
    meta: meta(),
  })

  async function attempt(
    controller: AbortController,
    timedOut: () => boolean
  ): Promise<Failure | IslandResult> {
    const { signal } = controller
    let response: Response
    try {
      response = await doFetch(encoded.url, {
        ...request.init,
        method: encoded.method,
        headers: encoded.headers,
        ...(encoded.body === undefined ? {} : { body: encoded.body }),
        credentials: 'omit',
        // After the spread so `init` cannot re-enable following redirects.
        redirect: 'error',
        signal,
      })
    } catch (error) {
      if (
        timedOut() ||
        errorName(error) === 'AbortError' ||
        errorName(error) === 'TimeoutError'
      ) {
        return { code: 'NF-008', retry: false }
      }
      if (error instanceof TypeError) {
        // `redirect: 'error'` surfaces as a TypeError (undici: cause "unexpected
        // redirect"; browsers: message mentions the redirect). A redirect is
        // deterministic, so it is a non-retryable failure, unlike a network blip.
        return { code: 'NF-007', retry: !isRedirectError(error) }
      }
      throw error
    }
    const hint = notAnIslandRemote(response)
      ? ({ hint: 'not-an-island-remote' } as const)
      : {}
    if (!response.ok) {
      return {
        code: 'NF-007',
        status: response.status,
        ...hint,
        retry: RETRYABLE_STATUS.has(response.status),
      }
    }
    let body: Uint8Array | null
    try {
      body = await readBodyLimited(
        response,
        target.maxBytes ?? MAX_ENVELOPE_BYTES
      )
    } catch (error) {
      if (timedOut() || errorName(error) === 'AbortError') {
        return { code: 'NF-008', retry: false }
      }
      return { code: 'NF-007', retry: true }
    }
    // Over the limit: the body was cancelled, and the request is aborted (a
    // wrapping fetch, like Next's, may read its own copy of the body, which
    // cancelling ours does not stop). Deterministic, so not retried.
    if (body === null) {
      controller.abort()
      return { code: 'NF-007', retry: false }
    }
    bytes = body.byteLength
    try {
      const text = new TextDecoder().decode(body)
      const envelope = parseEnvelope(JSON.parse(text) as unknown)
      assertEnvelopeUrls(envelope, target.allowedOrigins)
      if (envelope.remote !== target.remote) {
        throw new NFError(
          'NF-004',
          `Envelope is for remote "${envelope.remote}", expected "${target.remote}".`
        )
      }
      return { ok: true, envelope, meta: meta() }
    } catch (error) {
      if (isNFError(error)) {
        return { code: error.code as IslandFailureCode, ...hint, retry: false }
      }
      return { code: 'NF-004', ...hint, retry: false }
    }
  }

  for (;;) {
    const remaining = target.timeoutMs - elapsed()
    if (remaining <= 0) return fail({ code: 'NF-008', retry: false })
    attempts++

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, remaining)

    let outcome: Failure | IslandResult
    try {
      outcome = await attempt(controller, () => timedOut)
    } finally {
      clearTimeout(timer)
    }
    if ('meta' in outcome) return outcome
    const failure = outcome

    const budgetLeft = target.timeoutMs - elapsed() - RETRY_DELAY_MS
    if (!failure.retry || attempts > target.retries || budgetLeft <= 0) {
      return fail(failure)
    }
    await sleep(RETRY_DELAY_MS)
  }
}

export function eventFor(
  target: IslandTarget,
  island: string,
  result: IslandResult
): FederationEvent {
  if (result.ok) {
    return {
      type: 'island:fetch',
      remote: target.remote,
      island,
      ms: result.meta.ms,
      bytes: result.meta.bytes,
      attempts: result.meta.attempts,
    }
  }
  return {
    type: 'island:error',
    remote: target.remote,
    island,
    ms: result.meta.ms,
    attempts: result.meta.attempts,
    code: result.code,
    ...(result.status === undefined ? {} : { status: result.status }),
  }
}
