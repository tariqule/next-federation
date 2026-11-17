import { NFError } from '@next-federation/sdk'
import {
  ID_PLACEHOLDER_PATTERN,
  NAME_PATTERN,
  PROTOCOL_VERSION,
} from './constants.ts'

export type ReactMode = 'development' | 'production'

export type HostContext = {
  basePath: string
  /** URL prefix segment; '' for none or the default locale. */
  locale: string
}

export type IslandEnvelope = {
  protocolVersion: 1
  remote: string
  buildId: string
  /** React mode of the server that rendered the island. */
  mode: ReactMode
  html: string
  rscPayload: string
  /** Absolute URLs. */
  css: string[]
  /** Absolute URL of an ES module implementing `IslandBootstrapModule`. */
  bootstrap: string
  reactVersion: string
  /** Token in html/rscPayload the host replaces with a per-mount prefix. */
  idPlaceholder: string
  /**
   * Name of the rendered island. Optional (added with Server Actions); the bootstrap
   * sends it as the advisory `island` query on action requests.
   */
  island?: string
}

const STRING_FIELDS = [
  'remote',
  'buildId',
  'html',
  'rscPayload',
  'bootstrap',
  'reactVersion',
  'idPlaceholder',
] as const

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export function parseEnvelope(json: unknown): IslandEnvelope {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new NFError('NF-004', 'The envelope is not a JSON object.')
  }
  const e = json as Record<string, unknown>
  if (e.protocolVersion !== PROTOCOL_VERSION) {
    throw new NFError(
      'NF-003',
      `Unsupported protocolVersion ${String(e.protocolVersion)}; this host speaks ${PROTOCOL_VERSION}.`
    )
  }
  for (const field of STRING_FIELDS) {
    if (typeof e[field] !== 'string') {
      throw new NFError('NF-004', `Missing or invalid field "${field}".`)
    }
  }
  if (!ID_PLACEHOLDER_PATTERN.test(e.idPlaceholder as string)) {
    throw new NFError(
      'NF-004',
      `Field "idPlaceholder" must match ${ID_PLACEHOLDER_PATTERN.source}.`
    )
  }
  if (
    e.island !== undefined &&
    (typeof e.island !== 'string' || !NAME_PATTERN.test(e.island))
  ) {
    throw new NFError('NF-004', 'Field "island" must be an island name.')
  }
  if (e.mode !== 'development' && e.mode !== 'production') {
    throw new NFError(
      'NF-004',
      'Field "mode" must be "development" or "production".'
    )
  }
  if (!Array.isArray(e.css) || !e.css.every((c) => typeof c === 'string')) {
    throw new NFError('NF-004', 'Field "css" must be an array of strings.')
  }
  if (!isAbsoluteUrl(e.bootstrap as string)) {
    throw new NFError('NF-004', 'Field "bootstrap" must be an absolute URL.')
  }
  for (const href of e.css as string[]) {
    if (!isAbsoluteUrl(href)) {
      throw new NFError('NF-004', `css entry "${href}" is not an absolute URL.`)
    }
  }
  return e as unknown as IslandEnvelope
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null
  } catch {
    return null
  }
}

export function assertEnvelopeUrls(
  envelope: IslandEnvelope,
  allowedOrigins: readonly string[]
): void {
  const allowed = new Set(allowedOrigins.map((o) => originOf(o) ?? o))
  const check = (kind: string, value: string): void => {
    const origin = originOf(value)
    if (origin === null || !allowed.has(origin)) {
      throw new NFError(
        'NF-005',
        `${kind} URL "${value}" is not on an allowed origin (${[...allowed].join(', ')}).`
      )
    }
  }
  check('bootstrap', envelope.bootstrap)
  for (const href of envelope.css) check('css', href)
}
