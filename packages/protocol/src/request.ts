import { NFError } from '@next-federation/sdk'
import { GET_PROPS_LIMIT, ISLAND_PATH, NAME_PATTERN } from './constants.ts'
import type { HostContext } from './envelope.ts'
import { canonicalJson } from './props.ts'

export type EncodedIslandRequest = {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

// Browser- and Node-safe base64url (no Buffer: this module also runs in the browser).
function toBase64Url(text: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(bin, (c) => c.charCodeAt(0))
  )
}

// A scan, not `/\/+$/`: that regex is quadratic on a long run of inner slashes.
function trimTrailingSlashes(text: string): string {
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 0x2f) end--
  return text.slice(0, end)
}

const NO_HOST: HostContext = { basePath: '', locale: '' }
const isNoHost = (h: HostContext): boolean =>
  h.basePath === '' && h.locale === ''

export function encodeIslandRequest(
  base: string,
  island: string,
  props: unknown,
  opts: { token?: string; host?: HostContext } = {}
): EncodedIslandRequest {
  if (!NAME_PATTERN.test(island)) {
    throw new NFError('NF-002', `Island name "${island}" is not valid.`)
  }
  const host = opts.host ?? NO_HOST
  const headers: Record<string, string> = { accept: 'application/json' }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  const url = `${trimTrailingSlashes(base)}${ISLAND_PATH}${island}`
  const propsJson = canonicalJson(props ?? {})
  const p = toBase64Url(propsJson)
  if (p.length <= GET_PROPS_LIMIT) {
    let query = `?p=${p}`
    if (!isNoHost(host)) query += `&h=${toBase64Url(canonicalJson(host))}`
    return { url: url + query, method: 'GET', headers }
  }
  headers['content-type'] = 'application/json'
  return {
    url,
    method: 'POST',
    headers,
    body: canonicalJson({ props: props ?? {}, host }),
  }
}

const bad = (detail: string, cause?: unknown): NFError =>
  new NFError('NF-004', detail, cause === undefined ? undefined : { cause })

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw bad(`${what} is not valid JSON.`, cause)
  }
}

function decodeParam(value: string, what: string): unknown {
  try {
    return parseJson(fromBase64Url(value), what)
  } catch (cause) {
    if (cause instanceof NFError) throw cause
    throw bad(`${what} is not valid base64url.`, cause)
  }
}

function asHost(value: unknown): HostContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw bad('Host context is not an object.')
  }
  const { basePath = '', locale = '' } = value as Record<string, unknown>
  if (typeof basePath !== 'string' || typeof locale !== 'string') {
    throw bad('Host context basePath and locale must be strings.')
  }
  return { basePath, locale }
}

export async function decodeIslandRequest(
  req: Request
): Promise<{ island: string; props: unknown; host: HostContext }> {
  const url = new URL(req.url)
  const at = url.pathname.lastIndexOf(ISLAND_PATH)
  if (at === -1) throw bad(`"${url.pathname}" is not an island path.`)
  let island: string
  try {
    island = decodeURIComponent(url.pathname.slice(at + ISLAND_PATH.length))
  } catch (cause) {
    throw bad('Island name is not valid percent-encoding.', cause)
  }
  if (!NAME_PATTERN.test(island)) {
    throw bad(`Island name "${island}" is not valid.`)
  }
  if (req.method === 'POST') {
    let body: unknown
    try {
      body = parseJson(await req.text(), 'Request body')
    } catch (cause) {
      if (cause instanceof NFError) throw cause
      throw bad('Request body could not be read.', cause)
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw bad('Request body is not an object.')
    }
    const { props = {}, host } = body as Record<string, unknown>
    return {
      island,
      props,
      host: host === undefined ? { ...NO_HOST } : asHost(host),
    }
  }
  const p = url.searchParams.get('p')
  const h = url.searchParams.get('h')
  return {
    island,
    props: p ? decodeParam(p, 'Query "p"') : {},
    host: h ? asHost(decodeParam(h, 'Query "h"')) : { ...NO_HOST },
  }
}
