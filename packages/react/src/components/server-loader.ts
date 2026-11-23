// Remote components server loader (Node only; the `browser` export condition
// maps this module to `server-loader.browser.ts`, so it never reaches a client
// bundle).
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
  ComponentInitLock,
  ComponentTrustKind,
  ComponentTrustPolicy,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'
import type {
  FederationInstance,
  ServerBuildInfo,
  ServerScope,
} from './runtime.ts'

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
 * loader's I/O when a cacheComponents prerender completes.
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
  /**
   * The runtime's own scope (one per Next layer, and one more per restart of
   * a runtime). Remote code sees its `globals` in place of the process-wide
   * Module Federation keys, and the MF runtime keys every remote by a URL
   * tagged with its `id`, so two layers (two Reacts) never share a loaded
   * build.
   */
  scope?: ServerScope
  /** Tests: how long a container's `init` waits for another layer's (ms). */
  initWaitMs?: number
}

/**
 * The remote builds whose server code this loader keeps apart per layer, by
 * the `metaData.pluginVersion` of their MF manifest and whether their server
 * entry bundles its own MF runtime. Any other build server-renders only in
 * the first layer that loads it. Re-verify on every bump of either plugin:
 * a unit test fails when the pinned or installed version is not listed.
 */
export const ISOLATED_SERVER_BUILDS: ReadonlyArray<{
  plugin: string
  pluginVersion: string
  bundlesRuntime: boolean
}> = [
  // Uses the host's runtime; its state is the share cache and init keys.
  {
    plugin: '@module-federation/vite',
    pluginVersion: '1.24.0',
    bundlesRuntime: false,
  },
  // Rspack or webpack: its own runtime, registry on `__FEDERATION__`. The
  // 2.9.2 and 2.9.3 server entries are the same code apart from versions
  // and module ids (same globals, same entry keys).
  {
    plugin: '@module-federation/enhanced',
    pluginVersion: '2.9.2',
    bundlesRuntime: true,
  },
  {
    plugin: '@module-federation/enhanced',
    pluginVersion: '2.9.3',
    bundlesRuntime: true,
  },
]

/**
 * The `globalThis` keys `@module-federation/vite` 1.24 server chunks keep
 * their state in: the share cache (`__mf_module_cache__`, first writer wins)
 * and one init promise per build (`__mf_init__…`).
 */
const isViteKey = (key: string): boolean =>
  key === '__mf_module_cache__' || key.startsWith('__mf_init__')

/**
 * The `globalThis` keys a Module Federation runtime (2.9) keeps its
 * process-wide registry in: instances by name, share scopes, snapshots and
 * entry loads. A server entry that bundles its own runtime (Rspack, webpack)
 * finds its instance there by name, so each layer's copy gets its own.
 */
const RUNTIME_KEYS = new Set([
  '__FEDERATION__',
  '__VMOK__',
  '__GLOBAL_LOADING_REMOTE_ENTRY__',
])

/** A server entry that never requires the host's runtime bundles its own. */
const HOST_RUNTIME_REQUIRE =
  /require\(\s*["']@module-federation\/runtime["']\s*\)/

/** Per scope: the store of the remote builds that bundle their own runtime. */
const runtimeStores = new WeakMap<ServerScope, Record<PropertyKey, unknown>>()

/**
 * A new runtime store: its registry starts with the scope's plugins as the
 * runtime's global plugins (`__GLOBAL_PLUGIN__`, which every instance the
 * bundled runtime creates registers), so a remote's own instance resolves
 * shared modules the host's way (hostSharesPlugin). The runtime fills in
 * the rest of the registry itself.
 */
function seededRuntimeStore(scope: ServerScope): Record<PropertyKey, unknown> {
  if (!scope.plugins?.length) return {}
  const registry = { __GLOBAL_PLUGIN__: [...scope.plugins] }
  return { __FEDERATION__: registry, __VMOK__: registry }
}

/**
 * The `globalThis` remote code is evaluated with: the real one, except for
 * the keys `isScoped` names, which live in `store` (the Proxy's target, so
 * the Proxy invariants hold for them). Nothing is written to the
 * process-wide object for them. This keeps cooperating builds apart; it is
 * not a sandbox (a verified build runs with the host process's rights).
 */
export function scopedGlobalThis(
  store: Record<PropertyKey, unknown>,
  isScoped: (key: string) => boolean
): typeof globalThis {
  const scoped = (key: PropertyKey): boolean =>
    typeof key === 'string' && isScoped(key)
  const real = globalThis as unknown as Record<PropertyKey, unknown>
  return new Proxy(store, {
    get: (target, key) =>
      scoped(key) ? Reflect.get(target, key) : Reflect.get(real, key),
    set: (target, key, value) =>
      scoped(key)
        ? Reflect.set(target, key, value)
        : Reflect.set(real, key, value),
    has: (target, key) =>
      scoped(key) ? Reflect.has(target, key) : Reflect.has(real, key),
    deleteProperty: (target, key) =>
      scoped(key)
        ? Reflect.deleteProperty(target, key)
        : Reflect.deleteProperty(real, key),
    defineProperty: (target, key, descriptor) => {
      if (scoped(key)) return Reflect.defineProperty(target, key, descriptor)
      const ok = Reflect.defineProperty(real, key, descriptor)
      // Proxy invariant: a property reported as non-configurable must exist
      // as one on the target too.
      if (ok && descriptor.configurable === false) {
        Reflect.defineProperty(target, key, descriptor)
      }
      return ok
    },
    getOwnPropertyDescriptor: (target, key) => {
      if (scoped(key)) return Reflect.getOwnPropertyDescriptor(target, key)
      const descriptor = Reflect.getOwnPropertyDescriptor(real, key)
      if (!descriptor || descriptor.configurable) return descriptor
      // Non-configurable on the real object: reported as such only when the
      // target holds it too (Proxy invariant).
      return Reflect.getOwnPropertyDescriptor(target, key)?.configurable ===
        false
        ? descriptor
        : { ...descriptor, configurable: true }
    },
    ownKeys: (target) => [
      ...new Set([
        ...Reflect.ownKeys(real).filter((key) => !scoped(key)),
        ...Reflect.ownKeys(target),
      ]),
    ],
  }) as unknown as typeof globalThis
}

let tag: string | undefined
/**
 * The fragment a scope's URLs are tagged with: random per process, so no
 * remote can name another layer's key.
 */
const TAG = (): string =>
  (tag ??= `#nf_host_${globalThis.crypto.randomUUID().replace(/-/g, '')}=`)

/** `url` with the scope's tag (a fragment: never sent, stripped before any fetch). */
const tagged = (url: string, scope: ServerScope | undefined): string =>
  scope ? `${untagged(url)}${TAG()}${scope.id}` : url

const untagged = (url: string): string => {
  const at = url.indexOf(TAG())
  return at === -1 ? url : url.slice(0, at)
}

/** A container's `init` waits this long at most for another layer's. */
const INIT_WAIT_MS = 10_000

/** Every container this loader evaluated (and its `init` wrapper). */
const evaluated = new WeakSet<object>()

const track = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) evaluated.add(value)
  return value
}

/** An init that has run for `waitMs` without settling, or waits on one. */
function isHung(lock: ComponentInitLock | undefined, waitMs: number): boolean {
  for (let l = lock; l && !l.done; l = l.waitingFor) {
    if (l.started !== undefined) return performance.now() - l.started >= waitMs
  }
  return false
}

/**
 * Every layer's copy of a `@module-federation/vite` container resolves the
 * host's shares through the one MF instance it finds by name in the process
 * (`__FEDERATION__`), whose share scope each `init` replaces: inits of one
 * container run one at a time. An `init` that waited `waitMs` for the one
 * before it fails without running (its load fails and is retried after the
 * cooldown). An `init` that has run for `waitMs` without settling is hung:
 * later inits stop waiting for it, so a hung one never blocks the container.
 */
export function serializedInit(
  name: string,
  container: unknown,
  waitMs: number = INIT_WAIT_MS
): unknown {
  const c = container as { init?: (...args: unknown[]) => unknown } | null
  const init = c?.init
  if (typeof init !== 'function') return container
  const wrapped = Object.create(c) as typeof c
  Object.defineProperty(wrapped, 'init', {
    enumerable: true,
    value: (...args: unknown[]) => {
      const locks = (componentTrustRegistry().initLocks ??= new Map())
      const latest = locks.get(name)
      const previous =
        latest && !latest.done && !isHung(latest, waitMs) ? latest : undefined
      const lock: ComponentInitLock = {
        settled: Promise.resolve(),
        done: false,
        ...(previous ? { waitingFor: previous } : {}),
      }
      const ready = previous
        ? new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new NFError(
                    'NF-029',
                    `The server entry of "${name}" is still initialising in another layer after ${waitMs} ms.`
                  )
                ),
              waitMs
            )
            ;(timer as { unref?: () => void }).unref?.()
            void previous.settled.then(() => {
              clearTimeout(timer)
              resolve()
            })
          })
        : Promise.resolve()
      const run = ready.then(() => {
        lock.started = performance.now()
        return init.apply(c, args)
      })
      // Released once this init settled, or (when it gave up waiting) once
      // the one before it did: two inits never overlap, unless one is hung.
      lock.settled = Promise.allSettled([previous?.settled, run]).then(() => {
        lock.done = true
      })
      locks.set(name, lock)
      void lock.settled.then(() => {
        if (locks.get(name) === lock) locks.delete(name)
      })
      return run
    },
  })
  return track(wrapped)
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
  opts: ServerLoaderOptions,
  /** Runs once the graph is verified, before any of it is evaluated. */
  check?: (graph: { bundlesRuntime: boolean }) => void,
  /** Runs right before the first of its code runs (after it compiled). */
  onRun?: () => void
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
  const bundlesRuntime = ![...sources.values()].some((code) =>
    HOST_RUNTIME_REQUIRE.test(code)
  )
  check?.({ bundlesRuntime })

  const instances = new Map<string, { exports: unknown }>()
  const scope = opts.scope
  let global: typeof globalThis = globalThis
  if (scope && bundlesRuntime) {
    // Its own runtime's registry, per layer (and the Vite keys, unused).
    let store = runtimeStores.get(scope)
    if (!store) runtimeStores.set(scope, (store = seededRuntimeStore(scope)))
    global = scopedGlobalThis(
      store,
      (key) => RUNTIME_KEYS.has(key) || isViteKey(key)
    )
  } else if (scope) {
    // The host's runtime (process-wide registry) and this layer's share
    // cache, which the runtime reads and seeds (`scope.globals`).
    global = scopedGlobalThis(
      scope.globals as Record<PropertyKey, unknown>,
      isViteKey
    )
  }
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
    // `globalThis` is a parameter: the remote's reads of it resolve to the
    // scoped one (see scopedGlobalThis).
    // `document`, `window` and `self` too: a bundled MF runtime prefers
    // `document.defaultView` over `globalThis`, and a server-side polyfill
    // of any of them would hand remote code the real global. In a scope
    // they are always undefined.
    const fn = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      'globalThis',
      'document',
      'window',
      'self',
      `${source}\n//# sourceURL=${url}`
    ) as (
      exports: unknown,
      require: (s: string) => unknown,
      module: { exports: unknown },
      filename: string,
      dirname: string,
      global: typeof globalThis,
      document: unknown,
      window: unknown,
      self: unknown
    ) => void
    onRun?.()
    fn(
      module.exports,
      require,
      module,
      url,
      new URL('.', url).href,
      global,
      scope ? undefined : (globalThis as { document?: unknown }).document,
      scope ? undefined : (globalThis as { window?: unknown }).window,
      scope ? undefined : (globalThis as { self?: unknown }).self
    )
    return module.exports
  }
  return track(load(entryUrl))
}

/**
 * What a verified JSON response of a build (its MF manifest, whatever its
 * URL) says about it, or null for a body that is not a JSON object.
 * `remotes`: 'none' for an empty list, 'nested' for a non-empty one, and
 * 'unknown' when there is no list (nested remotes cannot be ruled out).
 */
function readManifest(body: Uint8Array): {
  pluginVersion?: string
  remotes: 'none' | 'nested' | 'unknown'
} | null {
  let manifest: unknown
  try {
    manifest = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
  }
  if (typeof manifest !== 'object' || manifest === null) return null
  const { metaData, remotes } = manifest as {
    metaData?: { pluginVersion?: unknown }
    remotes?: unknown
  }
  const version = metaData?.pluginVersion
  return {
    ...(typeof version === 'string' ? { pluginVersion: version } : {}),
    remotes: !Array.isArray(remotes)
      ? 'unknown'
      : remotes.length
        ? 'nested'
        : 'none',
  }
}

type MfRegistry = {
  __INSTANCES__?: unknown[]
  __MANIFEST_LOADING__?: Record<string, unknown>
  moduleInfo?: Record<string, unknown>
  __SHARE__?: Record<string, unknown>
}

/**
 * Drops an MF instance a runtime replaced from the process-wide registry
 * (its entry in `__INSTANCES__` and the share scope it registered in
 * `__SHARE__`) and, with a scope, every registry entry keyed by that scope's
 * tag or host name (entry loads, manifest loads, snapshots, share scopes),
 * so a replaced instance or scope is never kept alive by them.
 */
export function forgetInstance(
  instance: FederationInstance,
  scope?: ServerScope
): void {
  const real = globalThis as unknown as {
    __FEDERATION__?: MfRegistry
    __GLOBAL_LOADING_REMOTE_ENTRY__?: Record<string, unknown>
  }
  const fed = real.__FEDERATION__
  const list = fed?.__INSTANCES__
  const at = list?.indexOf(instance) ?? -1
  if (at !== -1) list!.splice(at, 1)
  // MF registers an instance's share scopes under its id or name, once per
  // key: the next instance of that name registers its own.
  const own = (instance as { shareScopeMap?: unknown }).shareScopeMap
  const share = fed?.__SHARE__
  for (const key of Object.keys(share ?? {})) {
    if (own !== undefined && share![key] === own) delete share![key]
  }
  if (!scope) return
  const suffix = `${TAG()}${scope.id}`
  const host = `nf_host_${scope.id}`
  const drop = (record: Record<string, unknown> | undefined) => {
    for (const key of Object.keys(record ?? {})) {
      if (
        key.endsWith(suffix) ||
        key === host ||
        key.startsWith(`${host}:`) ||
        key.startsWith(`${host}@`)
      ) {
        delete record![key]
      }
    }
  }
  drop(real.__GLOBAL_LOADING_REMOTE_ENTRY__)
  drop(fed?.__MANIFEST_LOADING__)
  drop(fed?.moduleInfo)
  drop(share)
}

/**
 * The MF runtime plugin the host instance uses on the server. With a scope,
 * it tags the remote's manifest and entry URLs with the scope's id: the MF
 * runtime keys its process-wide state (manifest and entry loads, snapshots)
 * by those URLs, so each layer fetches, verifies and evaluates a build itself.
 */
export function createServerEntryPlugin(opts: ServerLoaderOptions): {
  name: string
  beforeRegisterRemote: <T extends { remote: { entry?: string } }>(args: T) => T
  afterResolve: <T extends { remoteInfo: { entry: string } }>(args: T) => T
  fetch: (url: string) => Promise<Response> | undefined
  loadEntry: (args: {
    remoteInfo: { name?: string; entry: string }
  }) => Promise<unknown>
  afterLoadEntry: (args: {
    remoteEntryExports?: unknown
    error?: unknown
  }) => Promise<void>
  createScript: (args: { url?: string }) => never
  preflight: (manifestUrl: string) => Promise<void>
} {
  const scope = opts.scope
  // Every build whose manifest this plugin checked (its scope keeps them for
  // the runtime's later instances): base -> what it learned.
  const checked = new Map<string, ServerBuildInfo>()
  const infoOf = (base: string): ServerBuildInfo | undefined =>
    checked.get(base) ?? scope?.builds.get(base)

  /** Refuses build `base` in this layer from now on (warned once). */
  const refuse = (
    base: string | undefined,
    reason: 'nested-remotes' | 'unchecked',
    detail: string
  ): never => {
    if (scope && base !== undefined) scope.blocked.set(base, reason)
    logger.warnOnce('NF-028', `${reason}:${base}:${scope?.layer ?? ''}`, detail)
    throw new NFError('NF-028', detail)
  }

  /**
   * A build this loader cannot keep apart per layer (not in
   * ISOLATED_SERVER_BUILDS) shares process-wide state with every other such
   * build: all of them server-render in one layer only, the first whose
   * such build evaluated; every other layer leaves them to the browser.
   */
  const refuseUnlisted = (base: string | undefined, what: string): void => {
    if (!scope) return
    // Not stored in `blocked`: serverBlock checks the claim again, so this
    // layer server-renders the build once no other layer holds it.
    if (base !== undefined) scope.unlisted.add(base)
    const owner = componentTrustRegistry().unlistedLayer
    if (owner === undefined || owner === scope.layer) return
    const detail = `The server code of ${what} cannot be kept apart per router layer, and another layer of this process server-renders such builds: it renders in the browser only here.`
    logger.warnOnce('NF-028', `unisolated:${base}:${scope.layer}`, detail)
    throw new NFError('NF-028', detail)
  }

  /**
   * Fetches and verifies one JSON file of a build and, when it is a manifest,
   * applies the checks below (refusing the build in this layer, warned once).
   */
  const checkJson = async (plain: string): Promise<Uint8Array> => {
    const base = opts.integrityFor(plain)?.base
    const body = await fetchVerified(plain, opts)
    // Every JSON response of the build is checked, whatever its URL,
    // before any server code is fetched or hashed.
    const manifest = readManifest(body)
    if (manifest && base !== undefined) {
      if (manifest.remotes === 'nested') {
        refuse(
          base,
          'nested-remotes',
          `The build at ${base} lists remotes of its own: their code would load outside the server loader (unverified, on the real global), so it renders in the browser only.`
        )
      }
      if (manifest.remotes === 'unknown') {
        refuse(
          base,
          'unchecked',
          `The manifest of the build at ${base} has no remotes list, so nested remotes cannot be ruled out: it renders in the browser only.`
        )
      }
      const { pluginVersion } = manifest
      const listed = ISOLATED_SERVER_BUILDS.find(
        (b) => b.pluginVersion === pluginVersion
      )
      const info: ServerBuildInfo = {
        ...(pluginVersion === undefined ? {} : { pluginVersion }),
        ...(listed ? { bundlesRuntime: listed.bundlesRuntime } : {}),
      }
      checked.set(base, info)
      scope?.builds.set(base, info)
      if (!listed) {
        refuseUnlisted(
          base,
          `the build at ${base} (Module Federation plugin version ${pluginVersion ?? 'unknown'})`
        )
      }
    }
    return body
  }

  // Manifests checked by `preflight`, handed to the MF runtime's fetch once.
  const prechecked = new Map<string, Uint8Array>()

  return {
    name: SERVER_LOADER_MARKER,
    beforeRegisterRemote(args) {
      if (typeof args.remote.entry === 'string') {
        args.remote.entry = tagged(args.remote.entry, scope)
      }
      return args
    },
    afterResolve(args) {
      args.remoteInfo.entry = tagged(args.remoteInfo.entry, scope)
      return args
    },
    fetch(url) {
      const plain = untagged(String(url))
      const base = opts.integrityFor(plain)?.base
      return (async () => {
        let body = prechecked.get(plain)
        prechecked.delete(plain)
        if (body === undefined) {
          try {
            body = await checkJson(plain)
          } catch (error) {
            // MF wraps errors of this hook in its own: the runtime reads ours.
            if (base !== undefined) scope?.failures.set(base, error)
            throw error
          }
        }
        return new Response(body as Uint8Array<ArrayBuffer>, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })()
    },
    /**
     * Checks a build's manifest before the MF runtime is asked to load it,
     * so a refusal (warned once, NF-028) or a failed fetch is thrown here,
     * never inside the MF runtime (which would log it again, with a stack).
     * The verified body is handed to the runtime's own fetch of it. A
     * manifest URL that is not JSON (the entry itself) is left to the entry
     * load, as the MF runtime does.
     */
    async preflight(manifestUrl) {
      if (!manifestUrl.includes('.json')) return
      const plain = untagged(manifestUrl)
      prechecked.set(plain, await checkJson(plain))
    },
    async loadEntry({ remoteInfo }) {
      const entryUrl = untagged(remoteInfo.entry)
      const base = opts.integrityFor(entryUrl)?.base
      let claimed = false
      let ran = false
      let container: unknown
      try {
        container = await evaluateServerEntry(
          entryUrl,
          opts,
          ({ bundlesRuntime }) => {
            const info = base === undefined ? undefined : infoOf(base)
            // No manifest was checked (a descriptor whose manifest is the
            // entry itself, or a response that was not JSON): nested
            // remotes and the plugin version cannot be ruled out.
            if (!info) {
              refuse(
                base,
                'unchecked',
                `The build at ${base ?? entryUrl} has no Module Federation manifest the server loader could check (nested remotes, plugin version): it renders in the browser only.`
              )
            }
            if (info!.bundlesRuntime === bundlesRuntime) return
            // Unlisted (or set up otherwise than listed): refused if another
            // layer has such builds; else this layer claims them, released
            // again if the build fails to evaluate.
            const what = `the build at ${base} (Module Federation plugin version ${info!.pluginVersion ?? 'unknown'}, ${bundlesRuntime ? 'with' : 'without'} its own runtime)`
            refuseUnlisted(base, what)
            if (scope && componentTrustRegistry().unlistedLayer === undefined) {
              componentTrustRegistry().unlistedLayer = scope.layer
              claimed = true
            }
          },
          () => {
            ran = true
          }
        )
      } catch (error) {
        // Released only when none of its code ran (a syntax error, for
        // example): code that ran may have written to the real global.
        if (
          claimed &&
          !ran &&
          componentTrustRegistry().unlistedLayer === scope?.layer
        ) {
          delete componentTrustRegistry().unlistedLayer
        }
        throw error
      }
      return remoteInfo.name === undefined
        ? container
        : serializedInit(remoteInfo.name, container, opts.initWaitMs)
    },
    // The MF runtime may hand over a container it found elsewhere (a global
    // named like the remote): only one this loader evaluated is used. A
    // failed load keeps its own error.
    async afterLoadEntry({ remoteEntryExports, error }) {
      if (error !== undefined) return
      if (
        typeof remoteEntryExports !== 'object' ||
        remoteEntryExports === null ||
        !evaluated.has(remoteEntryExports)
      ) {
        throw new NFError(
          'NF-027',
          `${SERVER_LOADER_MARKER}: a remote container the server loader did not evaluate is never used.`
        )
      }
    },
    // The MF runtime's own Node script loader (vm.runInThisContext, no
    // integrity check, the real global) never runs on the server.
    createScript({ url }) {
      throw new NFError(
        'NF-027',
        `${SERVER_LOADER_MARKER}: ${url ?? 'a script'} would load outside the server loader; refused.`
      )
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
    // Signed too: the type declarations' file list.
    ...(d.types === undefined ? {} : { types: d.types }),
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
  forgetInstance: typeof forgetInstance
}

export const serverLoader: ServerLoader | null = {
  canLoadServerCode,
  createServerEntryPlugin,
  isTrustedDescriptor,
  forgetInstance,
}
