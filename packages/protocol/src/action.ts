import { NFError } from '@next-federation/sdk'
import {
  ACTION_HEADER,
  ACTION_ID_PATTERN,
  ACTION_PATH,
  NAME_PATTERN,
} from './constants.ts'

export type ActionRequest = {
  /** Server reference id from `X-NF-Action` (`<file>#<export>`). */
  id: string
  /** The `island` query parameter, or null when absent. Advisory only. */
  island: string | null
  /** The request's content type as sent (needed to decode multipart bodies). */
  contentType: string
}

const bad = (detail: string): NFError => new NFError('NF-032', detail)

/** True when `id` is a well-formed action id (pattern, no `..`, no NUL). */
export function isActionId(id: string): boolean {
  return ACTION_ID_PATTERN.test(id) && !id.includes('..') && !id.includes('\0')
}

function isAllowedContentType(value: string): boolean {
  const [type = '', ...params] = value.split(';').map((p) => p.trim())
  const media = type.toLowerCase()
  const param = (name: string): string | undefined => {
    for (const p of params) {
      const eq = p.indexOf('=')
      if (eq === -1) continue
      if (p.slice(0, eq).trim().toLowerCase() !== name) continue
      return p
        .slice(eq + 1)
        .trim()
        .replace(/^"(.*)"$/, '$1')
    }
    return undefined
  }
  if (media === 'text/plain') return param('charset')?.toLowerCase() === 'utf-8'
  if (media === 'multipart/form-data') return Boolean(param('boundary'))
  return false
}

/**
 * Validates the parts of a Server Action request that need no body: the
 * `X-NF-Action` header, the optional `island` query and the content type.
 * Throws `NF-032` on any problem. Method and path are the server's job.
 */
export function parseActionRequest(req: Request): ActionRequest {
  const id = req.headers.get(ACTION_HEADER)
  if (id === null || !isActionId(id)) {
    throw bad(`Header "${ACTION_HEADER}" is missing or not a valid action id.`)
  }
  const query = new URL(req.url).searchParams
  let island: string | null = null
  if (query.has('island')) {
    const value = query.get('island') ?? ''
    if (!NAME_PATTERN.test(value)) throw bad('Query "island" is not valid.')
    island = value
  }
  const contentType = req.headers.get('content-type') ?? ''
  if (!isAllowedContentType(contentType)) {
    throw bad(
      'Content type must be text/plain;charset=UTF-8 or multipart/form-data.'
    )
  }
  return { id, island, contentType }
}

/** `<publicBase>_nf/action[?island=<name>]`; `publicBase` may end with `/` or not. */
export function actionEndpoint(publicBase: string, island?: string): string {
  const url = `${publicBase.replace(/\/+$/, '')}${ACTION_PATH}`
  return island === undefined
    ? url
    : `${url}?island=${encodeURIComponent(island)}`
}
