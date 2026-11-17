import { ACTION_HEADER, actionEndpoint } from '@next-federation/protocol'
import type { ActionReport } from '@next-federation/protocol'
import { ERROR_CODES, NFError } from '@next-federation/sdk'
import type { NFErrorCode } from '@next-federation/sdk'

export type CallServer = (id: string, args: unknown[]) => Promise<unknown>

export type CallServerOptions = {
  /** The build-pinned public base the bootstrap was served from. */
  url: string
  /** Sent as the advisory `island` query. */
  island?: string
  getToken?: () => Promise<string | null>
  /** Drops the cached token; receives the token the remote rejected. */
  invalidateToken?: (rejected: string) => void
  /** React's `encodeReply` from the flight client. */
  encodeReply(args: unknown[]): Promise<string | FormData>
  createFromReadableStream<T>(
    stream: ReadableStream<Uint8Array>,
    options: { callServer: CallServer }
  ): PromiseLike<T>
  onAction?: (report: ActionReport) => void
}

const now = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now()

async function errorCode(res: Response): Promise<NFErrorCode | undefined> {
  if (!res.headers.get('content-type')?.includes('application/json')) {
    return undefined
  }
  try {
    const { error } = (await res.json()) as { error?: unknown }
    return typeof error === 'string' && Object.hasOwn(ERROR_CODES, error)
      ? (error as NFErrorCode)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The error for a failed action response without an NF code in its body:
 * the remote's bare 404 and 413, a 5xx from the remote or a proxy, or
 * anything else that is not a Server Action response.
 */
function withoutCode(id: string, status: number): NFError {
  if (status === 404) {
    return new NFError(
      'NF-031',
      `Server Action "${id}" failed with status 404.`
    )
  }
  if (status === 413) {
    return new NFError(
      'NF-032',
      `Server Action "${id}": the request body is larger than the remote accepts (413).`
    )
  }
  if (status >= 500) {
    return new NFError(
      'NF-038',
      `Server Action "${id}" failed with a server or network failure (status ${status}).`
    )
  }
  return new NFError(
    'NF-038',
    `Server Action "${id}" got a response that is not a Server Action response (status ${status}).`
  )
}

/**
 * One Server Action client per island mount: posts to that mount's own remote build,
 * with that mount's token, so actions never cross islands or builds.
 */
export function createCallServer(options: CallServerOptions): CallServer {
  const url = actionEndpoint(options.url, options.island)
  const report = (r: ActionReport) => {
    try {
      options.onAction?.(r)
    } catch {
      // a reporting failure must not change the action's outcome
    }
  }

  const callServer: CallServer = async (id, args) => {
    const started = now()
    const body = await options.encodeReply(args)
    const send = (token: string | null) => {
      const headers: Record<string, string> = { [ACTION_HEADER]: id }
      if (token) headers.authorization = `Bearer ${token}`
      return fetch(url, {
        method: 'POST',
        headers,
        body,
        credentials: 'omit',
        // A redirect would resend the action elsewhere: refuse it.
        redirect: 'error',
      })
    }
    let retried = false
    let status = 0
    let code: NFErrorCode | undefined
    const done = (ok: boolean) =>
      report({
        ok,
        status,
        ...(code === undefined ? {} : { code }),
        ms: now() - started,
        retried,
      })

    let res: Response
    try {
      let token = (await options.getToken?.()) ?? null
      res = await send(token)
      if (res.status === 401 && token !== null) {
        code = await errorCode(res.clone())
        if (code === 'NF-014') {
          options.invalidateToken?.(token)
          const fresh = (await options.getToken?.()) ?? null
          if (fresh !== null && fresh !== token) {
            token = fresh
            retried = true
            code = undefined
            res = await send(token)
          }
        }
      }
    } catch (error) {
      done(false)
      throw error
    }
    status = res.status
    const type = res.headers.get('content-type') ?? ''
    if (status !== 200 || !type.startsWith('text/x-component')) {
      code = await errorCode(res)
      done(false)
      throw code === undefined
        ? withoutCode(id, status)
        : new NFError(
            code,
            `Server Action "${id}" failed with status ${status}.`
          )
    }
    if (res.body === null) {
      done(false)
      throw new NFError('NF-038', `Server Action "${id}" sent no body.`)
    }
    try {
      const { returnValue } = await options.createFromReadableStream<{
        returnValue: unknown
      }>(res.body, { callServer })
      const value = await returnValue
      done(true)
      return value
    } catch (error) {
      code = 'NF-033'
      done(false)
      throw error
    }
  }
  return callServer
}
