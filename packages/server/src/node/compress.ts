// nf-serve's response compression (node:zlib only): content negotiation, the
// rules for what is compressed, and an in-memory cache of compressed files.
import { extname } from 'node:path'
import { promisify } from 'node:util'
import {
  brotliCompress,
  constants,
  createBrotliCompress,
  createGzip,
  gzip,
} from 'node:zlib'
import type { BrotliOptions, ZlibOptions } from 'node:zlib'
import type { Transform } from 'node:stream'

export type Encoding = 'br' | 'gzip'

/** Bodies smaller than this are sent as they are: encoding them gains nothing. */
export const MIN_COMPRESS_BYTES = 1024

/** Default byte cap of nf-serve's compressed-file cache. */
export const DEFAULT_COMPRESSION_CACHE_BYTES: number = 64 * 1024 * 1024

/** Larger files are compressed as they stream, and not cached. */
export const MAX_CACHED_FILE_BYTES: number = 8 * 1024 * 1024

/**
 * Text formats. Images (other than SVG), fonts and archives are compressed
 * already: encoding them again costs CPU and saves nothing.
 */
const COMPRESSIBLE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.svg',
  '.html',
  '.htm',
  '.map',
  '.txt',
])

export function isCompressibleFile(file: string): boolean {
  return COMPRESSIBLE_EXTENSIONS.has(extname(file).toLowerCase())
}

/**
 * The encoding to send for an `Accept-Encoding` header: `br` before `gzip`
 * at equal weight, `null` for none (identity). q-values are honoured (`q=0`
 * refuses), and `*` stands for any coding the header does not name.
 */
export function negotiateEncoding(
  header: string | string[] | undefined
): Encoding | null {
  const value = Array.isArray(header) ? header.join(',') : header
  if (!value) return null
  const weights = new Map<string, number>()
  for (const part of value.split(',')) {
    const [rawName, ...params] = part.split(';')
    let name = rawName!.trim().toLowerCase()
    if (!name) continue
    if (name === 'x-gzip') name = 'gzip'
    let q = 1
    for (const param of params) {
      const [key, raw] = param.split('=').map((s) => s.trim())
      if (key?.toLowerCase() !== 'q') continue
      const parsed = Number(raw)
      q =
        raw !== undefined && raw !== '' && Number.isFinite(parsed) ? parsed : 0
    }
    // The first mention of a coding wins (a repeated one is ignored).
    if (!weights.has(name)) weights.set(name, Math.min(1, Math.max(0, q)))
  }
  const star = weights.get('*')
  const weight = (name: Encoding): number => weights.get(name) ?? star ?? 0
  const br = weight('br')
  const gz = weight('gzip')
  if (br <= 0 && gz <= 0) return null
  return br >= gz ? 'br' : 'gzip'
}

type Headers = Record<string, string | string[] | number | undefined>

const header = (headers: Headers, name: string): string =>
  String(headers[name] ?? '')

/**
 * Whether nf-serve may compress a response a build sent: a JSON body (island
 * envelopes, error bodies) the build did not encode, to a request that did
 * not carry a token. A per-user envelope stays as it is: compressing a body
 * that holds both caller-chosen props and per-user data would let an
 * observer of its length learn about the data (BREACH). Server Action
 * results (streamed Flight) are left alone too.
 */
export function isCompressibleResponse(
  method: string | undefined,
  status: number,
  responseHeaders: Headers,
  requestHeaders: Headers
): boolean {
  if (method === 'HEAD' || status !== 200) return false
  if (header(requestHeaders, 'authorization') !== '') return false
  if (header(responseHeaders, 'content-encoding') !== '') return false
  if (/\bno-transform\b/i.test(header(responseHeaders, 'cache-control'))) {
    return false
  }
  return /^application\/json\b/i.test(header(responseHeaders, 'content-type'))
}

/** `vary` with `Accept-Encoding` added once. */
export function addVary(vary: string | string[] | number | undefined): string {
  const current = Array.isArray(vary) ? vary.join(', ') : String(vary ?? '')
  const names = current
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (names.some((n) => n === '*' || n.toLowerCase() === 'accept-encoding')) {
    return names.join(', ')
  }
  return [...names, 'Accept-Encoding'].join(', ')
}

const brotliAsync = promisify(brotliCompress) as (
  body: Buffer,
  options: BrotliOptions
) => Promise<Buffer>
const gzipAsync = promisify(gzip) as (
  body: Buffer,
  options: ZlibOptions
) => Promise<Buffer>

/**
 * Compresses a whole file, once (it is cached). Brotli quality 9: within
 * about 10% of quality 11 at a few percent of its time, so the first request
 * for a large chunk does not wait close to a second.
 */
export function compressBody(
  body: Buffer,
  encoding: Encoding
): Promise<Buffer> {
  if (encoding === 'gzip') return gzipAsync(body, { level: 9 })
  return brotliAsync(body, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: 9,
      [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
    },
  })
}

/** A compressing stream (per-request settings), for streamed bodies. */
export function compressStream(encoding: Encoding): Transform {
  return encoding === 'gzip'
    ? createGzip({ level: 6 })
    : createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          [constants.BROTLI_PARAM_QUALITY]: 5,
        },
      })
}

export type FileVersion = { path: string; mtimeMs: number; size: number }

/**
 * Compressed files, per file version (path, mtime and size) and encoding,
 * least recently used out first once `maxBytes` is reached (an entry larger
 * than the cap is not kept). Concurrent requests for one entry share its
 * compression.
 */
export class CompressionCache {
  readonly maxBytes: number
  /** Bytes held by settled entries. */
  bytes = 0
  private readonly entries = new Map<
    string,
    { body: Promise<Buffer>; value?: Buffer }
  >()

  constructor(maxBytes: number = DEFAULT_COMPRESSION_CACHE_BYTES) {
    this.maxBytes = maxBytes
  }

  private keyOf(file: FileVersion, encoding: Encoding): string {
    return `${encoding}\0${file.mtimeMs}\0${file.size}\0${file.path}`
  }

  /** The compressed body, only when it is cached and settled. */
  peek(file: FileVersion, encoding: Encoding): Buffer | undefined {
    return this.entries.get(this.keyOf(file, encoding))?.value
  }

  get(
    file: FileVersion,
    encoding: Encoding,
    read: () => Promise<Buffer>
  ): Promise<Buffer> {
    const key = this.keyOf(file, encoding)
    const hit = this.entries.get(key)
    if (hit) {
      // Most recently used last.
      this.entries.delete(key)
      this.entries.set(key, hit)
      return hit.body
    }
    const entry: { body: Promise<Buffer>; value?: Buffer } = {
      body: read()
        .then((raw) => compressBody(raw, encoding))
        .then(
          (body) => {
            if (this.entries.get(key) !== entry) return body
            if (body.length > this.maxBytes) {
              this.entries.delete(key)
              return body
            }
            entry.value = body
            this.bytes += body.length
            this.evict()
            return body
          },
          (error: unknown) => {
            if (this.entries.get(key) === entry) this.entries.delete(key)
            throw error
          }
        ),
    }
    this.entries.set(key, entry)
    return entry.body
  }

  private evict(): void {
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.maxBytes) return
      // Still compressing: counted once it settles.
      if (entry.value === undefined) continue
      this.entries.delete(key)
      this.bytes -= entry.value.length
    }
  }
}
