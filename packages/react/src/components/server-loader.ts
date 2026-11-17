// Mode A server loader (Node only; the `browser` export condition maps this
// module to `server-loader.browser.ts`, so it never reaches a client bundle).
//
// Evaluates a remote build's CommonJS server entry graph, fetched over
// node:http, inside the host process: only after every file's sha384 matches
// the verified descriptor, with a `require` that resolves nothing but the
// host's own `@module-federation/runtime`.
import { NFError, logger } from '@next-federation/sdk'
import {
  componentDescriptorCanonical,
  componentTrustRegistry,
  nowSeconds,
  sha384Integrity,
  verifiedKey,
} from '@next-federation/protocol'
import type {
  ComponentTrustKind,
  ComponentTrustPolicy,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'

/** Marker strings the client-bundle check looks for (they must never ship to a browser). */
export const SERVER_LOADER_MARKER = 'nf-components-server-loader'

/** Per-request timeout of the loader's own I/O, in ms. */
export const LOADER_TIMEOUT_MS = 3000
/** Largest server file the loader accepts, in bytes. */
export const LOADER_MAX_BYTES: number = 10 * 1024 * 1024

const RELATIVE_REQUIRE = /require\(["'](\.\.?\/[^"']+)["']\)/g

type Http = typeof import('node:http')
type ProcessWithBuiltins = { getBuiltinModule?: (id: string) => unknown }

/** True when this runtime can evaluate remote server code (Node >= 20.16). */
export function canLoadServerCode(): boolean {
  const proc = (globalThis as { process?: ProcessWithBuiltins }).process
  return typeof proc?.getBuiltinModule === 'function'
}

function builtin<T>(id: string): T {
  const proc = (globalThis as { process?: ProcessWithBuiltins }).process
  return proc!.getBuiltinModule!(id) as T
}

/**
 * GET through node:http(s), not `fetch`: Next's instrumented fetch aborts the
 * loader's I/O when a cacheComponents prerender completes (spike 28S, G7).
 */
export function loaderGet(
  url: string,
  timeoutMs: number = LOADER_TIMEOUT_MS
): Promise<{
  status: number
  body: Uint8Array
  headers: Record<string, string>
}> {
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return Promise.reject(
      new NFError('NF-029', `${SERVER_LOADER_MARKER}: refusing ${url}.`)
    )
  }
  const http = builtin<Http>(
    target.protocol === 'https:' ? 'node:https' : 'node:http'
  )
  return new Promise((resolve, reject) => {
    const req = http.get(target, { timeout: timeoutMs }, (res) => {
      const chunks: Uint8Array[] = []
      let size = 0
      res.on('data', (chunk: Uint8Array) => {
        size += chunk.length
        if (size > LOADER_MAX_BYTES) {
          req.destroy(
            new NFError(
              'NF-029',
              `${url} is larger than ${LOADER_MAX_BYTES} bytes.`
            )
          )
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        const body = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          body.set(chunk, offset)
          offset += chunk.length
        }
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') headers[k] = v
        }
        resolve({ status: res.statusCode ?? 0, body, headers })
      })
      res.on('error', reject)
    })
    // Covers a server that stops sending, not only a slow connect.
    const timer = setTimeout(
      () =>
        req.destroy(
          new NFError('NF-029', `${url} timed out after ${timeoutMs} ms.`)
        ),
      timeoutMs
    )
    req.on('close', () => clearTimeout(timer))
    req.on('timeout', () =>
      req.destroy(
        new NFError('NF-029', `${url} timed out after ${timeoutMs} ms.`)
      )
    )
    req.on('error', reject)
  })
}

export type IntegrityLookup = (
  url: string
) => { base: string; integrity: Record<string, string> } | undefined

export type ServerLoaderOptions = {
  /** The verified integrity map of the build `url` belongs to. */
  integrityFor: IntegrityLookup
  /** What the remote's `require()` may resolve: only `@module-federation/runtime`. */
  hostModules: { '@module-federation/runtime': unknown }
  get?: typeof loaderGet
}

async function fetchVerified(
  url: string,
  opts: ServerLoaderOptions
): Promise<Uint8Array> {
  const build = opts.integrityFor(url)
  const path =
    build && url.startsWith(build.base) ? url.slice(build.base.length) : ''
  const expected = build?.integrity[path]
  if (!build || !expected) {
    throw new NFError(
      'NF-027',
      `${url} is not listed in its build's verified descriptor; it is never evaluated.`
    )
  }
  const res = await (opts.get ?? loaderGet)(url)
  if (res.status !== 200) {
    throw new NFError('NF-029', `${url} answered HTTP ${res.status}.`)
  }
  const actual = await sha384Integrity(res.body)
  if (actual !== expected) {
    logger.warnOnce(
      'NF-027',
      build.base,
      `${url} does not match its sha384 in the verified descriptor (expected ${expected}, got ${actual}); this build renders in the browser only.`
    )
    throw new NFError(
      'NF-027',
      `${url} does not match its sha384 in the verified descriptor.`
    )
  }
  return res.body
}

/**
 * Fetches a manifest (or any file of a verified build) for the MF runtime's
 * `fetch` hook, checked against the build's integrity map.
 */
export async function fetchVerifiedResponse(
  url: string,
  opts: ServerLoaderOptions
): Promise<Response> {
  const body = await fetchVerified(url, opts)
  return new Response(body as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function isListed(url: string, opts: ServerLoaderOptions): boolean {
  const build = opts.integrityFor(url)
  return (
    !!build &&
    url.startsWith(build.base) &&
    build.integrity[url.slice(build.base.length)] !== undefined
  )
}

/**
 * Fetches the whole CommonJS graph of `entryUrl` (the entry and every
 * relative `require`), verifies every file, and only then evaluates the
 * entry. A digest mismatch anywhere evaluates nothing.
 */
export async function evaluateServerEntry(
  entryUrl: string,
  opts: ServerLoaderOptions
): Promise<unknown> {
  const sources = new Map<string, string>()
  const visit = async (url: string): Promise<void> => {
    if (sources.has(url)) return
    sources.set(url, '')
    const code = new TextDecoder().decode(await fetchVerified(url, opts))
    sources.set(url, code)
    // The scan also matches require() text in strings and comments: only
    // files the verified descriptor lists are fetched. A real require() of
    // anything else fails at evaluation (NF-027, not in the verified graph).
    await Promise.all(
      [...code.matchAll(RELATIVE_REQUIRE)]
        .map((m) => new URL(m[1]!, url).href)
        .filter((next) => isListed(next, opts))
        .map((next) => visit(next))
    )
  }
  await visit(entryUrl)

  const instances = new Map<string, { exports: unknown }>()
  const load = (url: string): unknown => {
    const hit = instances.get(url)
    if (hit) return hit.exports
    const source = sources.get(url)
    if (source === undefined) {
      throw new NFError('NF-027', `${url} was not part of the verified graph.`)
    }
    const module = { exports: {} as unknown }
    instances.set(url, module)
    const require = (specifier: string): unknown => {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        return load(new URL(specifier, url).href)
      }
      if (specifier === '@module-federation/runtime') {
        return opts.hostModules['@module-federation/runtime']
      }
      throw new NFError(
        'NF-030',
        `${url} required "${specifier}", which the host does not provide (${SERVER_LOADER_MARKER} resolves only @module-federation/runtime; declare shared modules as host-provided).`
      )
    }
    // CommonJS wrapper. Never `import()` or a temp file: those cannot be
    // unloaded, and an old build must be garbage-collectable.
    const fn = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      `${source}\n//# sourceURL=${url}`
    ) as (
      exports: unknown,
      require: (s: string) => unknown,
      module: { exports: unknown },
      filename: string,
      dirname: string
    ) => void
    fn(module.exports, require, module, url, new URL('.', url).href)
    return module.exports
  }
  return load(entryUrl)
}

/** The MF runtime plugin the host instance uses on the server. */
export function createServerEntryPlugin(opts: ServerLoaderOptions): {
  name: string
  fetch: (url: string) => Promise<Response> | undefined
  loadEntry: (args: { remoteInfo: { entry: string } }) => Promise<unknown>
} {
  return {
    name: SERVER_LOADER_MARKER,
    fetch(url) {
      return fetchVerifiedResponse(String(url), opts)
    },
    loadEntry({ remoteInfo }) {
      return evaluateServerEntry(remoteInfo.entry, opts)
    },
  }
}

type Crypto = typeof import('node:crypto')

const b64url = (text: string): Uint8Array =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0)
  )

function verifyJwsSync(
  jws: string,
  canonical: string,
  policy: ComponentTrustPolicy,
  crypto: Crypto
): boolean {
  const parts = jws.split('.')
  if (parts.length !== 3) return false
  const [h, p, sig] = parts as [string, string, string]
  let header: { alg?: unknown; typ?: unknown; kid?: unknown }
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(h))) as typeof header
    if (new TextDecoder().decode(b64url(p)) !== canonical) return false
  } catch {
    return false
  }
  if (header.alg !== 'ES256' || header.typ !== 'nf-components+jws') return false
  const input = new TextEncoder().encode(`${h}.${p}`)
  for (const jwk of policy.publicKeys) {
    if (
      jwk.kid !== undefined &&
      header.kid !== undefined &&
      jwk.kid !== header.kid
    ) {
      continue
    }
    try {
      const key = crypto.createPublicKey({ key: { ...jwk }, format: 'jwk' })
      if (
        crypto.verify(
          'sha256',
          input,
          { key, dsaEncoding: 'ieee-p1363' },
          b64url(sig)
        )
      ) {
        return true
      }
    } catch {
      // Try the next key.
    }
  }
  return false
}

/**
 * True when this process may evaluate the descriptor's server code: its
 * payload digest was recorded by `verifyComponentDescriptor` in this process,
 * or it re-verifies here, synchronously, against the trust policies
 * `defineFederation` registered for its remote (carried JWS, a pin, or
 * unsafe-dev). A descriptor prop's `ssr` alone is never trusted.
 */
export function isTrustedDescriptor(d: RemoteComponentDescriptor): boolean {
  // Node < 20.16: no node:crypto through getBuiltinModule, and no server
  // rendering anyway.
  if (!d.ssr || !canLoadServerCode()) return false
  let origin: string
  try {
    origin = new URL(d.base).origin
  } catch {
    return false
  }
  const canonical = componentDescriptorCanonical({
    v: 1,
    name: d.name,
    buildId: d.buildId,
    base: d.base,
    manifest: d.manifest,
    ssr: d.ssr,
    ...(d.iat === undefined ? {} : { iat: d.iat }),
    // Signed with the rest: the stylesheet and modulepreload URLs a host renders.
    ...(d.assets === undefined ? {} : { assets: d.assets }),
    // Signed too: what the host's shared modules must satisfy.
    ...(d.shared === undefined ? {} : { shared: d.shared }),
  })
  const crypto = builtin<Crypto>('node:crypto')
  const digest = `sha384-${crypto.createHash('sha384').update(canonical).digest('base64')}`
  const registry = componentTrustRegistry()
  const key = verifiedKey(d.remote, digest)
  const policies = registry.trust.get(d.remote) ?? []
  const now = nowSeconds()
  // As verifyComponentDescriptor: a build time over 60 s ahead is refused.
  if (d.iat !== undefined && d.iat > now + 60) return false
  const fits = (policy: ComponentTrustPolicy): boolean =>
    policy.allowedOrigins.includes(origin) &&
    (policy.name === null || policy.name === d.name)
  // `ssr.maxAge` bounds signed builds only (as in verifyComponentDescriptor):
  // a pin or unsafe-dev trusts the build whatever its age.
  const fresh = (policy: ComponentTrustPolicy): boolean =>
    policy.maxAgeSeconds === null ||
    (d.iat !== undefined && now - d.iat <= policy.maxAgeSeconds)
  const recorded = registry.verified.get(key)
  if (recorded !== undefined) {
    // Verified in this process: still bound by the remote's current policy.
    return (
      policies.length === 0 ||
      policies.some(
        (policy) => fits(policy) && (recorded !== 'signature' || fresh(policy))
      )
    )
  }
  for (const policy of policies) {
    if (!fits(policy)) continue
    const kind: ComponentTrustKind | null =
      policy.pinned[d.buildId] === digest
        ? 'pinned'
        : d.jws !== undefined &&
            policy.publicKeys.length > 0 &&
            fresh(policy) &&
            verifyJwsSync(d.jws, canonical, policy, crypto)
          ? 'signature'
          : policy.unsafeDev
            ? 'unsafe-dev'
            : null
    if (kind) {
      registry.verified.set(key, kind)
      return true
    }
  }
  return false
}

export type ServerLoader = {
  canLoadServerCode: typeof canLoadServerCode
  createServerEntryPlugin: typeof createServerEntryPlugin
  isTrustedDescriptor: typeof isTrustedDescriptor
}

export const serverLoader: ServerLoader | null = {
  canLoadServerCode,
  createServerEntryPlugin,
  isTrustedDescriptor,
}
