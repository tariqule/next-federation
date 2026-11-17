import { fork } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTION_PATH,
  BUILD_ID_PATTERN,
  COMPONENTS_DESCRIPTOR_FILE,
  COMPONENTS_DESCRIPTOR_PATH,
  DEFAULT_MAX_BODY_BYTES,
  HEALTH_PATH,
} from '@next-federation/protocol'
import { NFError, logger } from '@next-federation/sdk'
import {
  CompressionCache,
  MAX_CACHED_FILE_BYTES,
  MIN_COMPRESS_BYTES,
  addVary,
  compressStream,
  isCompressibleFile,
  isCompressibleResponse,
  negotiateEncoding,
} from './compress.ts'
import { DEFAULT_RETENTION, planRetention } from './retention.ts'
import type { BuildInfo, Retention } from './retention.ts'
import type { Encoding, FileVersion } from './compress.ts'

export type ServeBuildsOptions = {
  dir: string
  port: number
  host?: string
  current?: string
  retention?: Partial<Retention>
  /** Request body cap enforced while proxying. Default: the protocol's body limit. */
  maxBodyBytes?: number
  /**
   * Body cap for `/_nf/action` requests. Default 8 MiB: above the build's own action
   * limit (1 MiB by default), so the build's 413 is what callers normally see.
   */
  maxActionBodyBytes?: number
  /** Max wait for a build's response headers, in ms. Default 30000. Exceeded: 504. */
  upstreamTimeoutMs?: number
  /**
   * Byte cap of the in-memory cache of compressed static files (brotli and
   * gzip, per file version). Default 64 MiB.
   */
  compressionCacheBytes?: number
  /**
   * Called when a build's process exits while the server is running (a crash).
   * The server keeps running and answers 502 for that build; a supervisor-friendly
   * caller (such as the `nf-serve` CLI) should close and exit non-zero.
   * Not called for exits caused by `close()`.
   */
  onExit?: (info: {
    buildId: string
    code: number | null
    signal: NodeJS.Signals | null
  }) => void
}

export type ServedBuilds = {
  close(): Promise<void>
  live: string[]
  retired: string[]
  current: string
  /** The port actually bound (differs from `port` when `port` is 0). */
  port: number
}

/** Default nf-serve ceiling for `/_nf/action` bodies (the build enforces its own, lower limit). */
export const DEFAULT_MAX_ACTION_CEILING: number = 8 * 1024 * 1024

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** A build folder: an island build (its own server process) or a Mode A components build (static files). */
export type BuildEntry = BuildInfo & { kind: 'islands' | 'components' }

export async function readBuilds(dir: string): Promise<BuildEntry[]> {
  const builds: BuildEntry[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !BUILD_ID_PATTERN.test(entry.name)) continue
    let info: unknown
    try {
      info = JSON.parse(
        await readFile(join(dir, entry.name, 'nf-build.json'), 'utf8')
      )
    } catch {
      continue
    }
    const { buildId, builtAt, kind } = (info ?? {}) as Partial<BuildInfo> & {
      kind?: unknown
    }
    if (buildId === entry.name && typeof builtAt === 'number') {
      builds.push({
        buildId,
        builtAt,
        kind: kind === 'components' ? 'components' : 'islands',
      })
    }
  }
  return builds
}

function stripHopByHop(
  headers: IncomingMessage['headers']
): Record<string, string | string[]> {
  const named = new Set(
    String(headers.connection ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
  const out: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || named.has(name)) continue
    out[name] = value
  }
  return out
}

function startChild(
  file: string,
  buildDir: string,
  track: (child: ChildProcess) => void
): Promise<{ child: ChildProcess; port: number }> {
  return new Promise((resolveChild, reject) => {
    const child = fork(file, [buildDir], {
      execArgv: [],
      env: { ...process.env, NODE_ENV: 'production' },
    })
    track(child)
    child.once('message', (message) => {
      const port = (message as { port?: number } | null)?.port
      if (typeof port === 'number' && port > 0) resolveChild({ child, port })
      else reject(new Error(`build at ${buildDir} reported no port`))
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      reject(new Error(`build at ${buildDir} exited early (${code})`))
    )
  })
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done()
    child.once('exit', () => done())
    child.kill()
  })
}

/**
 * Files in a build's browser folder that no browser or host needs: dot
 * folders and files (Vite's `.vite/manifest.json`, Module Federation's
 * `.vite/mf-preload.json`) and Module Federation's `mf-stats.json`. They are
 * build-time inputs for tools, and list source paths and shared versions.
 */
function isBuildBookkeeping(rel: string): boolean {
  const parts = rel.split(sep)
  return parts.some((part) => part.startsWith('.')) || rel === 'mf-stats.json'
}

export async function serveBuilds(
  opts: ServeBuildsOptions
): Promise<ServedBuilds> {
  const retention: Retention = {
    maxBuilds: opts.retention?.maxBuilds ?? DEFAULT_RETENTION.maxBuilds,
    minAgeMs: opts.retention?.minAgeMs ?? DEFAULT_RETENTION.minAgeMs,
  }
  const root = resolve(opts.dir)
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const maxActionBody = opts.maxActionBodyBytes ?? DEFAULT_MAX_ACTION_CEILING
  const builds = await readBuilds(root)
  const compressed = new CompressionCache(opts.compressionCacheBytes)
  const plan = planRetention(builds, Date.now(), retention, opts.current)
  const liveSet = new Set(plan.live)
  const componentBuilds = new Set(
    builds.filter((b) => b.kind === 'components').map((b) => b.buildId)
  )

  const self = fileURLToPath(import.meta.url)
  const oneFile = join(dirname(self), `serve-one${extname(self)}`)

  const children: ChildProcess[] = []
  const ports = new Map<string, number>()
  const timeoutMs = opts.upstreamTimeoutMs ?? 30_000
  let closing = false
  const killAll = () => {
    for (const c of children) c.kill()
  }
  try {
    await Promise.all(
      // Components builds are static files: no process of their own.
      plan.live
        .filter((id) => !componentBuilds.has(id))
        .map(async (id) => {
          const started = await startChild(oneFile, join(root, id), (c) =>
            children.push(c)
          )
          ports.set(id, started.port)
          started.child.on('exit', (code, signal) => {
            if (closing) return
            logger.error(
              'NF-012',
              `Build "${id}" exited unexpectedly (code ${code}, signal ${signal}).`
            )
            opts.onExit?.({ buildId: id, code, signal })
          })
        })
    )
  } catch (error) {
    // Every forked child is tracked before it reports a port, so slow siblings die too.
    closing = true
    await Promise.all(children.map(exited))
    throw error
  }
  const onParentExit = () => killAll()
  process.once('exit', onParentExit)

  const retired = (res: ServerResponse) => {
    res.writeHead(410, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify({ error: 'NF-023' }))
  }
  const plain = (res: ServerResponse, status: number) => {
    if (!res.headersSent) res.writeHead(status)
    res.end()
  }
  // nf-serve's own proxy errors: bodyless, so readable from any origin (as the 410 is).
  const proxyError = (res: ServerResponse, status: number) => {
    if (!res.headersSent) {
      res.writeHead(status, {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      })
    }
    res.end()
  }

  async function serveAsset(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    rawRest: string,
    cacheControl = 'public, max-age=31536000, immutable'
  ) {
    let rest: string
    try {
      rest = decodeURIComponent(rawRest)
    } catch {
      return plain(res, 404)
    }
    if (rest === '' || rest.includes('\0')) return plain(res, 404)
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405)
    try {
      const clientDir = await realpath(join(root, id, 'client'))
      const file = await realpath(resolve(clientDir, rest))
      const rel = relative(clientDir, file)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        return plain(res, 404)
      }
      if (isBuildBookkeeping(rel)) return plain(res, 404)
      const info = await stat(file)
      if (!info.isFile()) return plain(res, 404)
      await sendFile(
        req,
        res,
        { path: file, mtimeMs: info.mtimeMs, size: info.size },
        {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cache-control': cacheControl,
          'access-control-allow-origin': '*',
        }
      )
    } catch {
      plain(res, 404)
    }
  }

  /**
   * Sends a file, brotli- or gzip-encoded when it is text of at least
   * MIN_COMPRESS_BYTES and the request accepts it. A range request gets the
   * whole file unencoded (as every request did before compression). HEAD
   * sends GET's headers; its Content-Length only when the encoded body is
   * cached already.
   */
  async function sendFile(
    req: IncomingMessage,
    res: ServerResponse,
    file: FileVersion,
    headers: Record<string, string>
  ) {
    const compressible =
      isCompressibleFile(file.path) && file.size >= MIN_COMPRESS_BYTES
    const encoding =
      compressible && req.headers.range === undefined
        ? negotiateEncoding(req.headers['accept-encoding'])
        : null
    const out: Record<string, string | number> = {
      ...headers,
      ...(compressible ? { vary: 'Accept-Encoding' } : {}),
    }
    const head = req.method === 'HEAD'
    if (!encoding) {
      res.writeHead(200, { ...out, 'content-length': file.size })
      if (head) return res.end()
      createReadStream(file.path)
        .on('error', () => res.destroy())
        .pipe(res)
      return
    }
    out['content-encoding'] = encoding
    if (file.size > MAX_CACHED_FILE_BYTES) {
      res.writeHead(200, out)
      if (head) return res.end()
      const zip = compressStream(encoding)
      zip.on('error', () => res.destroy())
      createReadStream(file.path)
        .on('error', () => res.destroy())
        .pipe(zip)
        .pipe(res)
      return
    }
    if (head) {
      const cached = compressed.peek(file, encoding)
      res.writeHead(
        200,
        cached ? { ...out, 'content-length': cached.length } : out
      )
      return res.end()
    }
    const body = await compressed.get(file, encoding, () => readFile(file.path))
    res.writeHead(200, { ...out, 'content-length': body.length })
    res.end(body)
  }

  async function serveDescriptor(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    cacheControl: string
  ) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405)
    try {
      const path = join(root, id, COMPONENTS_DESCRIPTOR_FILE)
      const info = await stat(path)
      await sendFile(
        req,
        res,
        { path, mtimeMs: info.mtimeMs, size: info.size },
        {
          'content-type': 'application/json',
          'cache-control': cacheControl,
          'access-control-allow-origin': '*',
        }
      )
    } catch {
      plain(res, 404)
    }
  }

  /**
   * Streams a build's response encoded, once it is known to be at least
   * MIN_COMPRESS_BYTES (a smaller one is sent as it is).
   */
  function sendCompressed(
    res: ServerResponse,
    up: IncomingMessage,
    status: number,
    headers: Record<string, string | string[]>,
    encoding: Encoding
  ) {
    const head: Buffer[] = []
    let size = 0
    const plainBody = () => {
      up.off('data', onData)
      const body = Buffer.concat(head)
      res.writeHead(status, {
        ...headers,
        'content-length': String(body.length),
      })
      res.end(body)
    }
    const onData = (chunk: Buffer) => {
      head.push(chunk)
      size += chunk.length
      if (size < MIN_COMPRESS_BYTES) return
      up.off('data', onData)
      up.off('end', plainBody)
      up.pause()
      delete headers['content-length']
      // A strong validator names exact bytes, which these are not.
      const etag = headers.etag
      if (typeof etag === 'string' && !etag.startsWith('W/')) {
        headers.etag = `W/${etag}`
      }
      res.writeHead(status, { ...headers, 'content-encoding': encoding })
      const zip = compressStream(encoding)
      zip.on('error', () => res.destroy())
      zip.pipe(res)
      for (const buffered of head) zip.write(buffered)
      up.pipe(zip)
    }
    up.on('data', onData)
    up.once('end', plainBody)
  }

  function proxy(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    path: string
  ) {
    const pathname = path.split('?')[0]!
    const limit = pathname.endsWith(ACTION_PATH) ? maxActionBody : maxBody
    const declared = req.headers['content-length']
    if (declared !== undefined && Number(declared) > limit) {
      return proxyError(res, 413)
    }
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: ports.get(id),
        method: req.method,
        path,
        headers: stripHopByHop(req.headers),
      },
      (up) => {
        const status = up.statusCode ?? 502
        const headers = stripHopByHop(up.headers)
        up.on('error', () => res.destroy())
        if (!isCompressibleResponse(req.method, status, headers, req.headers)) {
          res.writeHead(status, headers)
          up.pipe(res)
          return
        }
        headers.vary = addVary(headers.vary)
        const encoding = negotiateEncoding(req.headers['accept-encoding'])
        if (!encoding) {
          res.writeHead(status, headers)
          up.pipe(res)
          return
        }
        sendCompressed(res, up, status, headers, encoding)
      }
    )
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      upstream.destroy()
      proxyError(res, 504)
    }, timeoutMs)
    upstream.on('response', () => clearTimeout(timer))
    upstream.on('error', () => {
      clearTimeout(timer)
      if (!timedOut) proxyError(res, 502)
    })
    res.on('close', () => {
      clearTimeout(timer)
      upstream.destroy()
    })
    let seen = 0
    req.on('data', (chunk: Buffer) => {
      seen += chunk.length
      if (seen > limit) {
        req.unpipe(upstream)
        upstream.destroy()
        proxyError(res, 413)
      }
    })
    req.pipe(upstream)
  }

  const server = createServer((req, res) => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://nf-serve.invalid')
    } catch {
      return plain(res, 400)
    }
    const pinned = /^\/b\/([^/]+)(\/.*)?$/.exec(url.pathname)
    if (pinned) {
      let id: string
      try {
        id = decodeURIComponent(pinned[1]!)
      } catch {
        return plain(res, 404)
      }
      if (!liveSet.has(id)) return retired(res)
      const rest = pinned[2] ?? '/'
      if (componentBuilds.has(id)) {
        // A components build: every file of its browser folder (which holds
        // the server entry and chunks too), and its descriptor.
        if (rest === `/${COMPONENTS_DESCRIPTOR_FILE}`) {
          return void serveDescriptor(
            req,
            res,
            id,
            'public, max-age=31536000, immutable'
          )
        }
        return void serveAsset(req, res, id, rest.slice(1))
      }
      if (rest.startsWith('/assets/')) {
        void serveAsset(req, res, id, rest.slice(1))
        // `rest` starts with `assets/`: Vite writes to client/assets/, so resolve from client/.
        return
      }
      if (rest.startsWith('/_nf/'))
        return proxy(req, res, id, rest + url.search)
      return plain(res, 404)
    }
    if (componentBuilds.has(plan.current)) {
      if (url.pathname === COMPONENTS_DESCRIPTOR_PATH) {
        return void serveDescriptor(req, res, plan.current, 'no-store')
      }
      if (url.pathname === HEALTH_PATH) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ ok: true, buildId: plan.current }))
      }
    }
    if (url.pathname.startsWith('/_nf/')) {
      if (componentBuilds.has(plan.current)) return plain(res, 404)
      return proxy(req, res, plan.current, url.pathname + url.search)
    }
    plain(res, 404)
  })

  try {
    await new Promise<void>((ok, fail) => {
      server.once('error', fail)
      server.listen(opts.port, opts.host ?? '127.0.0.1', () => ok())
    })
  } catch (error) {
    killAll()
    process.off('exit', onParentExit)
    throw new NFError('NF-002', 'nf-serve could not bind its port.', {
      cause: error,
    })
  }

  return {
    live: plan.live,
    retired: plan.retired,
    current: plan.current,
    port: (server.address() as AddressInfo).port,
    async close() {
      closing = true
      process.off('exit', onParentExit)
      await new Promise<void>((done) => {
        server.close(() => done())
        server.closeAllConnections()
      })
      await Promise.all(children.map(exited))
    },
  }
}
