// Mode A host runtime: one Module Federation instance per environment (the
// SSR layer and the browser), which loads remote builds' exposed modules on
// the host's own React. Framework-free; the 'use client' entry wires it.
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { NFError, isNFError, logger } from '@next-federation/sdk'
import type { NFErrorCode } from '@next-federation/sdk'

export type RemoteModule = { default: unknown; [name: string]: unknown }

/** A promise React's `use()` can read synchronously once settled. */
export type Thenable<T> = Promise<T> & {
  status: 'pending' | 'fulfilled' | 'rejected'
  value?: T
  reason?: unknown
  failedAt?: number
}

/** Modules the host provides to remotes: `{ [specifier]: { version, module } }`. */
export type SharedModules = Record<string, { version: string; module: unknown }>

type MfShared = Record<
  string,
  {
    version: string
    lib: () => unknown
    shareConfig: { singleton: true; requiredVersion: false }
  }
>

/** The part of `@module-federation/runtime`'s instance the runtime uses. */
export type FederationInstance = {
  registerRemotes(
    remotes: Array<{ name: string; entry: string }>,
    options?: { force?: boolean }
  ): void
  registerShared(shared: MfShared): void
  loadRemote<T>(id: string): Promise<T | null | undefined>
}

export type ComponentEvent =
  | {
      type: 'component:load'
      remote: string
      buildId: string
      expose: string
      ms: number
      env: 'server' | 'client'
    }
  | {
      type: 'component:error'
      remote: string
      buildId: string
      expose: string
      code: NFErrorCode
      error: unknown
      env: 'server' | 'client'
    }

export type IntegrityLookup = (
  url: string
) => { base: string; integrity: Record<string, string> } | undefined

export type RuntimeDeps = {
  isServer: boolean
  /** This environment's React (the one rendering the host). */
  react: { useState?: unknown }
  /** react, react-dom, react-dom/client, react/jsx-runtime of this environment. */
  hostShared: SharedModules
  createInstance: (options: {
    name: string
    remotes: []
    shared: MfShared
    plugins: unknown[]
  }) => FederationInstance
  /** Server only: the MF plugin that fetches, verifies and evaluates server code. */
  serverPlugin?: (integrityFor: IntegrityLookup) => unknown
  /** Server only: Node can evaluate remote code (`process.getBuiltinModule`). */
  canLoadServerCode: () => boolean
  /**
   * Server only: this process verified (or re-verifies) the descriptor. A
   * descriptor prop's `ssr` is never trusted on its own. Default: nothing is.
   */
  isTrusted?: (descriptor: RemoteComponentDescriptor) => boolean
  /**
   * Browser only: imports a remote entry (ES module) by URL. Retries use it
   * with a fresh query, since the browser caches a failed module import.
   */
  importEntry?: (url: string) => Promise<unknown>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  emit?: (event: ComponentEvent) => void
  /** Browser: delays between attempts. Default [500, 1000, 2000]. */
  clientRetryDelays?: number[]
  /** Server: a failed load is retried after this many ms. Default 1000. */
  serverRetryMs?: number
  /**
   * One load attempt (registration, manifest, entry, chunks) fails after this
   * many ms. Default 10000. A server render must never wait forever.
   */
  loadTimeoutMs?: number
}

/** Why the server does not render a build (it renders in the browser instead). */
export type ServerBlock =
  | 'unverified'
  | 'untrusted'
  | 'node'
  | 'react'
  | 'stale'

export type ComponentRuntime = {
  registerShared(shared: SharedModules): void
  /** The exposed module of one build; cached per build (see `maxBuilds`). */
  load(
    descriptor: RemoteComponentDescriptor,
    expose: string
  ): Thenable<RemoteModule>
  /** Server: null when this build may be evaluated here, else why not. */
  serverBlock(descriptor: RemoteComponentDescriptor): ServerBlock | null
  /**
   * Server render: the module, or null (render browser-only). Checks before
   * and after the load; one result per descriptor object, so re-renders in
   * one request never start another attempt.
   */
  serverLoad(
    descriptor: RemoteComponentDescriptor,
    expose: string
  ): Thenable<RemoteModule | null>
  /** Build ids of a container kept loaded, oldest first. */
  loadedBuilds(name: string): string[]
}

const toMfShared = (shared: SharedModules): MfShared =>
  Object.fromEntries(
    Object.entries(shared).map(([name, { version, module }]) => [
      name,
      {
        version,
        lib: () => module,
        shareConfig: { singleton: true, requiredVersion: false },
      },
    ])
  )

type ShareCache = { share?: Record<string, { useState?: unknown } | undefined> }

/**
 * `@module-federation/vite` server chunks read a process-wide share cache
 * (`globalThis.__mf_module_cache__`), first writer wins: in a process with
 * two Reacts (an App Router + Pages Router host) a remote would get whichever
 * registered first, and after a dev server reloads the host's modules it
 * keeps the old instances. Returns the first host module the cache holds a
 * different copy of, or null. Read only.
 */
function staleSharedModule(
  react: { useState?: unknown },
  modules: Map<string, unknown>
): string | null {
  const cache = (globalThis as { __mf_module_cache__?: ShareCache })
    .__mf_module_cache__?.share
  if (!cache) return null
  const reactShared = cache['default:react'] ?? cache.react
  if (
    reactShared !== undefined &&
    reactShared !== react &&
    reactShared.useState !== react.useState
  ) {
    return 'react'
  }
  for (const [name, module] of modules) {
    if (name === 'react') continue
    const shared = cache[`default:${name}`] ?? cache[name]
    if (shared !== undefined && shared !== module) return name
  }
  return null
}

const TIMED_OUT = Symbol('nf-timed-out')

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  detail: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new NFError('NF-029', detail), { [TIMED_OUT]: true })
        ),
      ms
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const sameIntegrity = (
  a: Record<string, string>,
  b: Record<string, string>
): boolean => {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  )
}

export function createComponentRuntime(deps: RuntimeDeps): ComponentRuntime {
  const now = deps.now ?? (() => performance.now())
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const delays = deps.clientRetryDelays ?? [500, 1000, 2000]
  const serverRetryMs = deps.serverRetryMs ?? 1000
  const loadTimeoutMs = deps.loadTimeoutMs ?? 10_000
  const env = deps.isServer ? 'server' : 'client'

  // container name -> base -> expose -> thenable (Map order = recency).
  const cache = new Map<
    string,
    Map<string, Map<string, Thenable<RemoteModule>>>
  >()
  const buildIds = new Map<string, string>()
  // Server: the verified integrity map of every build kept loaded.
  const integrity = new Map<string, Record<string, string>>()
  const registered = new Map<string, string>()
  const locks = new Map<string, Promise<unknown>>()
  // Every registerShared call, replayed into each new MF instance (one is
  // created again after a timed-out load).
  const extraShared: SharedModules[] = []
  // Every module this runtime provides, for the share-cache check.
  const provided = new Map<string, unknown>(
    Object.entries(deps.hostShared).map(([name, { module }]) => [name, module])
  )
  let instance: FederationInstance | null = null

  // Browser: the retry number of each build's entry (base -> n).
  const entryRetries = new Map<string, number>()
  const longestBase = <T>(map: Map<string, T>, url: string) => {
    let best: string | undefined
    for (const base of map.keys()) {
      if (url.startsWith(base) && (!best || base.length > best.length)) {
        best = base
      }
    }
    return best
  }

  const integrityFor: IntegrityLookup = (url) => {
    const base = longestBase(integrity, url)
    return base === undefined
      ? undefined
      : { base, integrity: integrity.get(base)! }
  }

  // Browser: MF imports a remote entry with import(url), and the browser's
  // module map keeps a failed import; a retry imports it under a new URL.
  const retryEntryPlugin = {
    name: 'nf-components-retry-entry',
    loadEntry({ remoteInfo }: { remoteInfo: { entry: string } }) {
      const base = longestBase(entryRetries, remoteInfo.entry)
      const n = base === undefined ? 0 : entryRetries.get(base)!
      if (!n || !deps.importEntry) return undefined
      const sep = remoteInfo.entry.includes('?') ? '&' : '?'
      return deps.importEntry(`${remoteInfo.entry}${sep}nf_retry=${n}`)
    },
  }

  function getInstance(): FederationInstance {
    if (instance) return instance
    instance = deps.createInstance({
      name: 'nf_host',
      remotes: [],
      shared: toMfShared(deps.hostShared),
      plugins: deps.isServer
        ? deps.serverPlugin
          ? [deps.serverPlugin(integrityFor)]
          : []
        : [retryEntryPlugin],
    })
    for (const shared of extraShared) {
      instance.registerShared(toMfShared(shared))
    }
    return instance
  }

  function emit(event: ComponentEvent): void {
    try {
      deps.emit?.(event)
    } catch (error) {
      logger.debug('component event observer threw', error)
    }
  }

  // One registration + load at a time per container: MF registers a remote
  // by name, so a concurrent load of another build must not swap it midway.
  function withLock<T>(name: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(name) ?? Promise.resolve()
    const next = previous.then(task, task)
    const settled = next.then(
      () => undefined,
      () => undefined
    )
    locks.set(name, settled)
    void settled.then(() => {
      if (locks.get(name) === settled) locks.delete(name)
    })
    return next
  }

  async function loadOnce(
    d: RemoteComponentDescriptor,
    expose: string,
    fresh: boolean
  ): Promise<RemoteModule> {
    const mf = getInstance()
    const current = registered.get(d.name)
    if (current !== d.base || fresh) {
      mf.registerRemotes([{ name: d.name, entry: d.manifest }], {
        // Always: MF keeps remote state by name process-wide, and an earlier
        // copy of this runtime (a dev server reload) may have registered
        // another build of this container.
        force: true,
      })
      registered.set(d.name, d.base)
    }
    const mod = await mf.loadRemote<RemoteModule>(
      `${d.name}/${expose.replace(/^\.\//, '')}`
    )
    if (!mod || mod.default === undefined || mod.default === null) {
      throw new NFError(
        'NF-029',
        `${d.name}/${expose} (build ${d.buildId}) has no default export.`
      )
    }
    return mod
  }

  async function attempt(
    d: RemoteComponentDescriptor,
    expose: string,
    retry: boolean
  ): Promise<RemoteModule> {
    const started = now()
    const tries = deps.isServer ? 1 : 1 + delays.length
    let last: unknown
    for (let i = 0; i < tries; i++) {
      if (i > 0) await sleep(delays[i - 1]!)
      try {
        if (!deps.isServer) {
          if (i > 0) entryRetries.set(d.base, i)
          else entryRetries.delete(d.base)
        }
        const mod = await withLock(d.name, async () => {
          try {
            return await withTimeout(
              loadOnce(d, expose, retry || i > 0),
              loadTimeoutMs,
              `${d.remote}:${expose} (build ${d.buildId}) did not load within ${loadTimeoutMs} ms.`
            )
          } catch (error) {
            if ((error as { [TIMED_OUT]?: boolean })[TIMED_OUT]) {
              // The abandoned load may still finish and write into its MF
              // instance (module cache by container name): never reuse it.
              instance = null
              registered.clear()
            }
            throw error
          }
        })
        emit({
          type: 'component:load',
          remote: d.remote,
          buildId: d.buildId,
          expose,
          ms: Math.round(now() - started),
          env,
        })
        return mod
      } catch (error) {
        last = error
      }
    }
    const code: NFErrorCode = isNFError(last)
      ? (last as NFError).code
      : 'NF-029'
    logger.error(
      code,
      `Remote component ${d.remote}:${expose} (build ${d.buildId}) failed to load on the ${env}; rendering its fallback.`,
      last
    )
    emit({
      type: 'component:error',
      remote: d.remote,
      buildId: d.buildId,
      expose,
      code,
      error: last,
      env,
    })
    throw isNFError(last)
      ? last
      : new NFError('NF-029', `${d.remote}:${expose} failed to load.`, {
          cause: last,
        })
  }

  function thenable(promise: Promise<RemoteModule>): Thenable<RemoteModule> {
    const t = promise as Thenable<RemoteModule>
    t.status = 'pending'
    promise.then(
      (value) => {
        t.status = 'fulfilled'
        t.value = value
      },
      (reason: unknown) => {
        t.status = 'rejected'
        t.reason = reason
        t.failedAt = now()
      }
    )
    return t
  }

  function evict(
    name: string,
    builds: Map<string, Map<string, Thenable<RemoteModule>>>,
    maxBuilds: number
  ) {
    const max = Math.max(1, Math.floor(maxBuilds) || 1)
    for (const base of [...builds.keys()]) {
      if (builds.size <= max) break
      // A build still loading keeps its integrity map until it settles.
      const loading = [...builds.get(base)!.values()].some(
        (t) => t.status === 'pending'
      )
      if (loading) continue
      builds.delete(base)
      integrity.delete(base)
      buildIds.delete(base)
      entryRetries.delete(base)
      logger.debug(`evicted build ${base} of ${name}`)
    }
  }

  const serverResults = new WeakMap<
    RemoteComponentDescriptor,
    Map<string, Thenable<RemoteModule | null>>
  >()
  const resolved = <T>(value: T): Thenable<T> =>
    Object.assign(Promise.resolve(value), {
      status: 'fulfilled' as const,
      value,
    })

  const warned = new Set<string>()
  function warnOnce(key: string, detail: string): void {
    if (warned.has(key)) return
    warned.add(key)
    logger.warn('NF-028', detail)
  }

  return {
    registerShared(shared) {
      for (const [name, { module }] of Object.entries(shared)) {
        provided.set(name, module)
      }
      extraShared.push(shared)
      if (instance) instance.registerShared(toMfShared(shared))
    },

    load(d, expose) {
      let builds = cache.get(d.name)
      if (!builds) {
        builds = new Map()
        cache.set(d.name, builds)
      }
      let exposes = builds.get(d.base)
      const hit = exposes?.get(expose)
      if (exposes) {
        // Most recently used last.
        builds.delete(d.base)
        builds.set(d.base, exposes)
      }
      // A failed load stays cached: React re-renders after a rejection, and
      // a new promise per render would retry forever. The server retries
      // after a cooldown; a browser page never retries a settled failure.
      const retry =
        hit?.status === 'rejected' &&
        deps.isServer &&
        now() - (hit.failedAt ?? 0) >= serverRetryMs
      if (hit && !retry) return hit
      if (deps.isServer && d.ssr) {
        const known = integrity.get(d.base)
        if (known && !sameIntegrity(known, d.ssr.integrity)) {
          // Never replace the verified map of a build kept loaded.
          const reason = new NFError(
            'NF-027',
            `Build ${d.buildId} of ${d.remote} was given a different integrity map than the one it is loaded with; refused.`
          )
          const refused = Promise.reject(reason) as Thenable<RemoteModule>
          refused.status = 'rejected'
          refused.reason = reason
          refused.failedAt = now()
          refused.catch(() => {})
          return refused
        }
        integrity.set(d.base, d.ssr.integrity)
      }
      if (!exposes) {
        exposes = new Map()
        builds.set(d.base, exposes)
        buildIds.set(d.base, d.buildId)
        evict(d.name, builds, d.maxBuilds)
      }
      const p = thenable(attempt(d, expose, retry === true))
      exposes.set(expose, p)
      return p
    },

    serverBlock(d) {
      if (!d.ssr) return 'unverified'
      if (!deps.canLoadServerCode()) {
        warnOnce(
          'node',
          'This Node.js has no process.getBuiltinModule (needs Node >= 20.16): remote components render in the browser only.'
        )
        return 'node'
      }
      if (!(deps.isTrusted?.(d) ?? false)) {
        warnOnce(
          `untrusted:${d.base}`,
          `The descriptor of build "${d.buildId}" of "${d.remote}" is not trusted by this server process: it was not verified here, or no longer fits the remote's current policy (origin, container name, or ssr.maxAge for a signed build). Pass the value of getComponentDescriptor, never a hand-made or request-supplied descriptor. It renders in the browser only.`
        )
        return 'untrusted'
      }
      const stale = staleSharedModule(deps.react, provided)
      if (stale === 'react') {
        warnOnce(
          'react',
          'Another React already registered itself in the Module Federation share cache of this process (for example an App Router and a Pages Router route in one host): remote components render in the browser only here.'
        )
        return 'react'
      }
      if (stale) {
        warnOnce(
          `stale:${stale}`,
          `The Module Federation share cache of this process holds another instance of "${stale}" (a dev server reloaded the host's modules, or two copies are installed): remote components render in the browser only until the server restarts.`
        )
        return 'stale'
      }
      return null
    },

    serverLoad(d, expose) {
      let perDescriptor = serverResults.get(d)
      const hit = perDescriptor?.get(expose)
      // Re-renders within one request reuse the result; a host that keeps
      // one descriptor object across requests gets a new attempt once the
      // cooldown has passed since a failed (null) result.
      if (
        hit &&
        !(
          hit.status === 'fulfilled' &&
          hit.value === null &&
          now() - (hit.failedAt ?? Infinity) >= serverRetryMs
        )
      ) {
        return hit
      }
      let result: Thenable<RemoteModule | null>
      if (this.serverBlock(d)) {
        result = resolved(null)
      } else {
        const load = this.load(d, expose)
        // Checked again once loaded: another layer may have registered its
        // React (or another module copy) in the shared cache meanwhile.
        const after = (mod: RemoteModule): RemoteModule | null =>
          this.serverBlock(d) ? null : mod
        if (load.status === 'fulfilled') {
          result = resolved(after(load.value!))
        } else if (load.status === 'rejected') {
          result = resolved(null)
        } else {
          result = load.then(after, () => null) as Thenable<RemoteModule | null>
          result.status = 'pending'
          const r = result
          void r.then((value) => {
            r.status = 'fulfilled'
            r.value = value
            if (value === null) r.failedAt = now()
          })
        }
      }
      if (result.status === 'fulfilled' && result.value === null) {
        result.failedAt = now()
      }
      if (!perDescriptor) {
        perDescriptor = new Map()
        serverResults.set(d, perDescriptor)
      }
      perDescriptor.set(expose, result)
      return result
    },

    loadedBuilds(name) {
      return [...(cache.get(name)?.keys() ?? [])].map(
        (base) => buildIds.get(base) ?? base
      )
    },
  }
}
