// Remote components host runtime: one Module Federation instance per
// environment (each server layer and the browser), which loads remote builds'
// exposed modules on the host's own React. Framework-free; the 'use client'
// entry wires it.
import {
  DEFAULT_REACT_RANGE,
  HOST_REACT_MODULES,
  componentTrustRegistry,
  isNeverFallback,
  isSemverVersion,
  satisfies,
} from '@next-federation/protocol'
import type {
  ComponentSharedModule,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'
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

/**
 * Modules the host provides to remotes: `{ [specifier]: { version, module } }`.
 * `version` is the module's real semver version (its package.json): a
 * remote's `requiredVersion` is checked against it (NF-036).
 */
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

/** What the server loader learned about a build from its verified manifest. */
export type ServerBuildInfo = {
  pluginVersion?: string
  /** Whether its server entry bundles its own MF runtime, per the allowlist. */
  bundlesRuntime?: boolean
}

/**
 * Server: one runtime's own Module Federation state. A Next host with App
 * Router and Pages Router routes runs two runtimes (two Reacts) in one
 * process; each loads its own copy of a remote's server code against its own
 * React. `layer` is the runtime's number in the process (a `next dev
 * --webpack` reload creates one more); `id` is unique per scope. A runtime
 * gets a new scope only when its share cache holds a stale fallback copy
 * (at most MAX_SCOPES). `globals` holds what `@module-federation/vite`
 * server chunks keep on `globalThis` (their share cache and init state), for
 * this scope. `blocked` and `builds` belong to the runtime (all its scopes):
 * the builds the server loader refused here and why, what it learned from
 * each build's manifest, and its own error for a failed fetch.
 */
export type ServerScope = {
  id: string
  layer: string
  globals: Record<string, unknown>
  blocked: Map<string, ServerBlock>
  builds: Map<string, ServerBuildInfo>
  /** The loader's own error for a build's last failed fetch (MF may wrap it). */
  failures: Map<string, unknown>
  /**
   * Builds the loader cannot keep apart per layer: refused here only while
   * another layer holds `componentTrustRegistry().unlistedLayer`.
   */
  unlisted: Set<string>
  /**
   * Module Federation plugins every runtime a remote's server entry bundles
   * (Rspack, webpack) gets in this scope (its `__GLOBAL_PLUGIN__`): the
   * host's shared-module resolution (hostSharesPlugin).
   */
  plugins?: unknown[]
}

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
  serverPlugin?: (integrityFor: IntegrityLookup, scope: ServerScope) => unknown
  /**
   * Server only: drops an MF instance this runtime replaced from the
   * process-wide registry and, with a scope, every entry of that scope's
   * tag (entry loads, manifests, snapshots), so neither stays alive.
   */
  forget?: (instance: FederationInstance, scope?: ServerScope) => void
  /**
   * Browser only: Module Federation's `registerGlobalPlugins`. A remote that
   * bundles its own runtime (Rspack, webpack) creates its own instance, which
   * the host instance's plugins never reach; global plugins reach it.
   */
  registerGlobalPlugins?: (plugins: unknown[]) => void
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
  /** A build the loader cannot keep apart, and another layer server-renders those. */
  | 'unisolated'
  /** Its manifest lists remotes of its own: their code is never evaluated here. */
  | 'nested-remotes'
  /** A stale fallback copy again, after MAX_SCOPES scopes. */
  | 'scopes'
  /** No manifest the loader could check (nested remotes, plugin version). */
  | 'unchecked'

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
 * `@module-federation/vite` server chunks read a share cache, first writer
 * wins. The server loader gives each runtime its own (its scope's `globals`,
 * never the process-wide `globalThis.__mf_module_cache__`), so another
 * layer's React never lands in it. Returns the first host module the cache
 * holds a different copy of, or null: a defensive check. Read only.
 */
function staleSharedModule(
  react: { useState?: unknown },
  modules: Map<string, unknown>,
  holder: { __mf_module_cache__?: unknown }
): string | null {
  const cache = (holder.__mf_module_cache__ as ShareCache | undefined)?.share
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

/**
 * A `fallback` module whose host copy satisfies the build's range, while the
 * cache holds another object under the build's versioned key
 * (`default:<name>@<version>`, a bundled copy or an earlier host copy). The
 * browser seeds the host's current copy, so the server must not render.
 */
function staleFallbackCopy(
  d: RemoteComponentDescriptor,
  versions: Map<string, string>,
  modules: Map<string, unknown>,
  holder: { __mf_module_cache__?: unknown }
): string | null {
  const cache = (holder.__mf_module_cache__ as ModuleCache | undefined)?.share
  if (!cache) return null
  for (const { name, key } of seedableFallbacks(d, undefined, versions)) {
    const held = cache[`default:${key}`] ?? cache[key]
    if (held !== undefined && held !== modules.get(name)) return name
  }
  return null
}

/**
 * A `fallback` module the host registered at a version outside this build's
 * range, while the cache holds the host's copy under the build's versioned
 * key (seeded for another build of the same bundled version): the build
 * would read the host's copy, not its own. The server must not render it
 * from this scope (the browser of a fresh page loads the build's own copy).
 */
function hostCopyOutOfRange(
  d: RemoteComponentDescriptor,
  versions: Map<string, string>,
  modules: Map<string, unknown>,
  holder: { __mf_module_cache__?: unknown }
): string | null {
  const cache = (holder.__mf_module_cache__ as ModuleCache | undefined)?.share
  if (!cache) return null
  for (const [name, need] of Object.entries(d.shared ?? {})) {
    if (!need.fallback || need.version === undefined) continue
    if (need.requiredVersion === false || isNeverFallback(name)) continue
    const version = versions.get(name)
    if (version === undefined || satisfies(version, need.requiredVersion)) {
      continue
    }
    const key = `${name}@${need.version}`
    const held = cache[`default:${key}`] ?? cache[key]
    if (held !== undefined && held === modules.get(name)) return name
  }
  return null
}

type ShareEntry = { lib?: () => unknown; from?: string }
type ResolveShareArgs = {
  shareScopeMap: Record<string, Record<string, Record<string, ShareEntry>>>
  scope: string
  pkgName: string
  shareInfo?: {
    shareConfig?: {
      singleton?: boolean
      requiredVersion?: string | false
      import?: unknown
    }
  }
  resolver: () => { shared: ShareEntry; useTreesShaking: boolean } | undefined
}

/** The host's current Module Federation instance: its name and share scopes. */
export type HostInstanceInfo = {
  name: string
  shareScopeMap: Record<string, unknown>
} | null

/**
 * Module Federation runtime plugin: how a remote container that bundles its
 * own runtime (Rspack, webpack) resolves a shared module it may bundle
 * (`singleton: false`, a `fallback` entry). It acts only on a consumer
 * resolving from the host instance's own share scope, and only for a name
 * the host registered: the consumer gets the host's copy when the host's
 * version satisfies its `requiredVersion`, otherwise none, so it uses its
 * own bundled copy. Never another container's copy: without this, a bundled
 * copy one remote loaded (its range excluded the host's) becomes the highest
 * loaded version in the share scope and every later consumer it satisfies
 * gets it, for the life of the scope. Singletons, `import: false` consumers,
 * other share scopes (another Module Federation app on the page) and names
 * the host did not register keep Module Federation's own choice.
 */
export function hostSharesPlugin(
  versions: Map<string, string>,
  modules: Map<string, unknown>,
  hostInstance: () => HostInstanceInfo
): {
  name: string
  resolveShare: (args: ResolveShareArgs) => ResolveShareArgs
} {
  return {
    name: 'nf-components-host-shares',
    resolveShare(args) {
      const config = args.shareInfo?.shareConfig
      if (!config || config.singleton !== false || config.import === false) {
        return args
      }
      const { shareScopeMap, scope, pkgName } = args
      const host = hostInstance()
      const version = versions.get(pkgName)
      if (
        !host ||
        version === undefined ||
        shareScopeMap[scope] === undefined ||
        shareScopeMap[scope] !== host.shareScopeMap[scope]
      ) {
        return args
      }
      args.resolver = () => {
        const module = modules.get(pkgName)
        const range = config.requiredVersion
        const fits =
          range === undefined ||
          range === false ||
          range === '*' ||
          satisfies(comparedVersion(pkgName, version), range)
        if (!fits) return undefined
        // The host's entry: registered by the host instance at its version,
        // with a `lib` that returns its module. A copy is returned, with the
        // host's module fixed, so nothing swapped on the entry later counts.
        const entry = shareScopeMap[scope]?.[pkgName]?.[version]
        if (
          entry?.from !== host.name ||
          typeof entry.lib !== 'function' ||
          entry.lib() !== module
        ) {
          return undefined
        }
        return {
          shared: { ...entry, lib: () => module },
          useTreesShaking: false,
        }
      }
      return args
    },
  }
}

/** Server: the most scopes one runtime uses (see renewScope). */
export const MAX_SCOPES = 4

/** Modules only a Next.js host provides (`@next-federation/next/components`). */
const NEXT_MODULES = new Set(['next/link', 'next/navigation', 'next/router'])

/** `16.5.0-canary.3` -> `16.5.0` (build metadata dropped too). */
const releaseOf = (version: string): string => version.replace(/[-+].*$/, '')

/**
 * The host version a range is checked against: a canary or prerelease Next
 * host (and the canary React an App Router host runs) counts by its release
 * numbers, everywhere (the descriptor check and hostSharesPlugin agree).
 */
function comparedVersion(name: string, version: string): string {
  return NEXT_MODULES.has(name) || HOST_REACT_MODULES.includes(name)
    ? releaseOf(version)
    : version
}

function notProvidedHint(name: string): string {
  return NEXT_MODULES.has(name)
    ? 'next/link, next/navigation and next/router come only from a Next.js host that creates its remote components with @next-federation/next/components (App Router: next/link, next/navigation) or @next-federation/next/pages/components (Pages Router: next/link, next/router).'
    : 'Provide it with createRemoteComponent({ shared }), or let the remote bundle a copy (`fallback: true` in its `shared`).'
}

/**
 * The descriptor's shared modules, plus DEFAULT_REACT_RANGE for each React
 * module it does not list and the host registered: builds list React only
 * for another range, and every build made before remotes could declare one
 * was React 19-only.
 */
function sharedNeeds(
  d: RemoteComponentDescriptor,
  versions: Map<string, string>
): Array<[string, ComponentSharedModule]> {
  const needs = Object.entries(d.shared ?? {})
  for (const name of HOST_REACT_MODULES) {
    if (d.shared && Object.hasOwn(d.shared, name)) continue
    if (!versions.has(name)) continue
    needs.push([
      name,
      { requiredVersion: DEFAULT_REACT_RANGE, fallback: false },
    ])
  }
  return needs
}

/**
 * The first shared module this expose needs that the host cannot satisfy:
 * not provided, or a version outside the remote's `requiredVersion`. A
 * module with `fallback` is never refused here: the build carries its own
 * copy, used unless the host's satisfies (provideFallbackCopies).
 */
function unmetShared(
  d: RemoteComponentDescriptor,
  expose: string,
  versions: Map<string, string>
): NFError | null {
  for (const [name, need] of sharedNeeds(d, versions)) {
    if (need.fallback) continue
    if (need.exposes && !need.exposes.includes(expose)) continue
    const version = versions.get(name)
    const who = `${d.remote}:${expose} (build ${d.buildId})`
    if (version === undefined) {
      return new NFError(
        'NF-036',
        `${who} needs "${name}" from the host, which does not provide it. ${notProvidedHint(name)}`
      )
    }
    if (
      need.requiredVersion !== false &&
      !satisfies(comparedVersion(name, version), need.requiredVersion)
    ) {
      return new NFError(
        'NF-036',
        `${who} needs "${name}" ${JSON.stringify(need.requiredVersion)}, but the host provides ${version}. Upgrade the host's copy, widen the remote's requiredVersion, or let the remote bundle a copy (\`fallback: true\`).`
      )
    }
  }
  return null
}

type ModuleCache = { share?: Record<string, unknown>; remote?: unknown }

/**
 * The `fallback` modules of this expose (any expose when undefined) that the
 * host's copy satisfies: the ones provideFallbackCopies seeds.
 */
function seedableFallbacks(
  d: RemoteComponentDescriptor,
  expose: string | undefined,
  versions: Map<string, string>
): Array<{ name: string; key: string }> {
  const out: Array<{ name: string; key: string }> = []
  for (const [name, need] of Object.entries(d.shared ?? {})) {
    if (!need.fallback || need.version === undefined) continue
    // React and Next.js are always the host's (the parser refuses such
    // an entry too; never trust that alone before a global write).
    if (isNeverFallback(name)) continue
    if (expose !== undefined && need.exposes?.includes(expose) === false) {
      continue
    }
    const version = versions.get(name)
    if (version === undefined) continue
    if (
      need.requiredVersion !== false &&
      !satisfies(version, need.requiredVersion)
    ) {
      continue
    }
    out.push({ name, key: `${name}@${need.version}` })
  }
  return out
}

/**
 * A `fallback` module of this expose that the host registered, at a version
 * outside the build's range: the build uses its own copy (for
 * `@next-federation/router`, the document router: full page navigations).
 * Warned once per module and remote.
 */
function warnBundledCopies(
  d: RemoteComponentDescriptor,
  expose: string,
  versions: Map<string, string>
): void {
  for (const [name, need] of Object.entries(d.shared ?? {})) {
    if (!need.fallback || need.requiredVersion === false) continue
    if (isNeverFallback(name) || need.exposes?.includes(expose) === false) {
      continue
    }
    const version = versions.get(name)
    if (version === undefined || satisfies(version, need.requiredVersion)) {
      continue
    }
    logger.warnOnce(
      'NF-036',
      `bundled-copy:${d.remote}:${name}`,
      `${d.remote} bundles its own "${name}" (host has ${version}, remote needs ${JSON.stringify(need.requiredVersion)}).`
    )
  }
}

/**
 * `fallback` modules: a build's own copy is not a singleton, and its
 * `@module-federation/vite` share proxy resolves `default:<name>@<its
 * version>` in the module cache (`__mf_module_cache__`, the layout of the
 * pinned 1.24.0) before falling back to the bundled copy; it never asks the
 * share scope. When the host's copy satisfies the range, put it there, so
 * the build uses the host's copy. A key already set (a copy already
 * evaluated) is left alone. Every such module of the build is seeded,
 * whichever expose loads: the build's init caches its own copy of each
 * fallback share whose key is still empty, so an expose that imports it
 * later would read the bundled copy (and the server check, which reads all
 * of them, would find a stale copy). `holder`: the browser's `globalThis`
 * (one React per page), or on the server this runtime's scope (never the
 * process-wide object: another layer would read this layer's copy).
 */
function provideFallbackCopies(
  d: RemoteComponentDescriptor,
  expose: string,
  versions: Map<string, string>,
  modules: Map<string, unknown>,
  holder: { __mf_module_cache__?: ModuleCache }
): void {
  warnBundledCopies(d, expose, versions)
  for (const { name, key } of seedableFallbacks(d, undefined, versions)) {
    const cache = (holder.__mf_module_cache__ ??= { share: {}, remote: {} })
    const share = (cache.share ??= {})
    if (share[`default:${key}`] !== undefined || share[key] !== undefined) {
      continue
    }
    share[`default:${key}`] = modules.get(name)
  }
}

function assertVersions(shared: SharedModules): void {
  for (const [name, { version }] of Object.entries(shared)) {
    if (typeof version !== 'string' || !isSemverVersion(version)) {
      throw new NFError(
        'NF-002',
        `The shared module "${name}" needs its real version (a semver version such as "1.2.0", from its package.json), got ${JSON.stringify(version)}: remotes' requiredVersion ranges are checked against it.`
      )
    }
  }
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

/**
 * Drops an MF instance a runtime replaced from MF's page- or process-wide
 * registry: its entry in `__FEDERATION__.__INSTANCES__` and the share scopes
 * it registered in `__SHARE__`. MF registers those under an instance's id or
 * name once per key, so the next instance of that name registers its own.
 */
export function dropInstance(instance: FederationInstance): void {
  const fed = (
    globalThis as {
      __FEDERATION__?: {
        __INSTANCES__?: unknown[]
        __SHARE__?: Record<string, unknown>
      }
    }
  ).__FEDERATION__
  const list = fed?.__INSTANCES__
  const at = list?.indexOf(instance) ?? -1
  if (at !== -1) list!.splice(at, 1)
  const own = (instance as { shareScopeMap?: unknown }).shareScopeMap
  const share = fed?.__SHARE__
  if (own === undefined || !share) return
  for (const key of Object.keys(share)) {
    if (share[key] === own) delete share[key]
  }
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
  // The version of every module this runtime provides (NF-036 checks).
  const versions = new Map<string, string>(
    Object.entries(deps.hostShared).map(([name, { version }]) => [
      name,
      version,
    ])
  )
  let instance: FederationInstance | null = null
  // Server: the loader plugin of the current instance (its manifest check).
  let loaderPlugin: {
    preflight?: (manifestUrl: string) => Promise<void>
  } | null = null
  // Server: this runtime's own MF state (one per Next layer). Its number is
  // process-wide: each layer bundles its own copy of this module.
  const layer = deps.isServer
    ? String(
        (componentTrustRegistry().hostRuntimes =
          (componentTrustRegistry().hostRuntimes ?? 0) + 1)
      )
    : ''
  let scopes = 0
  const blocked = new Map<string, ServerBlock>()
  const buildInfo = new Map<string, ServerBuildInfo>()
  const failures = new Map<string, unknown>()
  const unlisted = new Set<string>()
  /** Why the server loader refuses build `base` in this layer now, if it does. */
  const refusal = (base: string): ServerBlock | undefined => {
    const reason = blocked.get(base)
    if (reason) return reason
    const owner = componentTrustRegistry().unlistedLayer
    return unlisted.has(base) && owner !== undefined && owner !== layer
      ? 'unisolated'
      : undefined
  }
  // The host's resolution of shared modules a remote may bundle, for the
  // runtimes remote containers bundle (Rspack, webpack).
  const sharesPlugin = hostSharesPlugin(versions, provided, () => {
    const current = instance as {
      options?: { name?: unknown }
      shareScopeMap?: Record<string, unknown>
    } | null
    return typeof current?.options?.name === 'string' && current.shareScopeMap
      ? { name: current.options.name, shareScopeMap: current.shareScopeMap }
      : null
  })
  let globalPluginRegistered = false
  const newScope = (): ServerScope => ({
    id: `${layer}.${++scopes}`,
    layer,
    globals: {},
    blocked,
    builds: buildInfo,
    failures,
    unlisted,
    plugins: [sharesPlugin],
  })
  let scope: ServerScope | null = deps.isServer ? newScope() : null
  // Server: the scope each load ran in (the post-load check reads that one).
  const loadScopes = new WeakMap<object, ServerScope>()
  // Where `@module-federation/vite` code of this runtime finds its module
  // cache: the browser's globalThis, or this runtime's current scope.
  const cacheHolder = (): { __mf_module_cache__?: ModuleCache } =>
    (scope?.globals ?? globalThis) as { __mf_module_cache__?: ModuleCache }
  /**
   * The next load gets a new MF instance and registers its remote again
   * (after a timed-out load, or a module registered late). The scope and its
   * tag stay: an entry load still running is reused, never started again.
   * The replaced instance leaves MF's registry (process- or page-wide).
   */
  const startOver = (): void => {
    const old = instance
    instance = null
    registered.clear()
    if (!old) return
    if (scope) deps.forget?.(old)
    else dropInstance(old)
  }
  /**
   * Server: a new scope (a clean share cache, its own tag: the remote's
   * server code is evaluated again), for a cache that holds a stale fallback
   * copy. Every expose loads again in it; the old scope's instance and
   * tagged entries are dropped. False once MAX_SCOPES scopes were used.
   */
  const renewScope = (): boolean => {
    if (!scope || scopes >= MAX_SCOPES) return false
    const old = { scope, instance }
    scope = newScope()
    instance = null
    registered.clear()
    for (const builds of cache.values()) {
      for (const exposes of builds.values()) exposes.clear()
    }
    if (old.instance) deps.forget?.(old.instance, old.scope)
    return true
  }

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
    if (!scope && !globalPluginRegistered) {
      // Before any remote entry creates its own instance.
      globalPluginRegistered = true
      deps.registerGlobalPlugins?.([sharesPlugin])
    }
    const plugin =
      scope && deps.serverPlugin ? deps.serverPlugin(integrityFor, scope) : null
    loaderPlugin = plugin as typeof loaderPlugin
    instance = deps.createInstance({
      // Server: one name per runtime. MF keeps a host's snapshot by name
      // process-wide, and two layers must never share one.
      name: scope ? `nf_host_${scope.id}` : 'nf_host',
      remotes: [],
      shared: toMfShared(deps.hostShared),
      plugins: scope ? (plugin ? [plugin] : []) : [retryEntryPlugin],
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
      // Server: the loader checks the manifest first, so its refusal
      // (NF-028) or a failed fetch is thrown here, never inside the MF
      // runtime (which logs what its hooks throw, with a stack).
      await loaderPlugin?.preflight?.(d.manifest)
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
    // Checked once: a module the host does not provide cannot appear on a retry.
    const unmet = unmetShared(d, expose, versions)
    // Seeded into the cache the load's instance uses (same scope: nothing
    // awaits in between). A browser page has one React; on the server,
    // never next to another instance of a host module in this scope's cache.
    const seed = (): void => {
      if (
        !unmet &&
        (!scope ||
          staleSharedModule(deps.react, provided, cacheHolder()) === null)
      ) {
        provideFallbackCopies(d, expose, versions, provided, cacheHolder())
      }
    }
    const tries = unmet ? 0 : deps.isServer ? 1 : 1 + delays.length
    let last: unknown = unmet
    for (let i = 0; i < tries; i++) {
      if (i > 0) await sleep(delays[i - 1]!)
      try {
        if (!deps.isServer) {
          if (i > 0) entryRetries.set(d.base, i)
          else entryRetries.delete(d.base)
        }
        const mod = await withLock(d.name, async () => {
          try {
            failures.delete(d.base)
            seed()
            return await withTimeout(
              loadOnce(d, expose, retry || i > 0),
              loadTimeoutMs,
              `${d.remote}:${expose} (build ${d.buildId}) did not load within ${loadTimeoutMs} ms.`
            )
          } catch (error) {
            if ((error as { [TIMED_OUT]?: boolean })[TIMED_OUT]) {
              // The abandoned load may still finish and write into its MF
              // instance (module cache by container name): never reuse the
              // instance. The scope stays, so its entry load, still
              // running, is reused by the next instance.
              startOver()
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
    // A build the server loader refused in this layer (MF may wrap that
    // refusal, from its manifest fetch, in its own error).
    const refused = refusal(d.base)
    if (refused && !(isNFError(last) && (last as NFError).code === 'NF-028')) {
      last = new NFError(
        'NF-028',
        `${d.remote}:${expose} (build ${d.buildId}) is not rendered on the server here (${refused}).`,
        { cause: last }
      )
    }
    // MF wraps errors of its manifest fetch in its own: the loader's error
    // for this build (an integrity failure, for example) is the real one.
    if (!refused && !isNFError(last) && failures.has(d.base)) {
      last = failures.get(d.base)
    }
    const code: NFErrorCode = isNFError(last)
      ? (last as NFError).code
      : 'NF-029'
    // A build the server loader refused in this layer: it warned once, and
    // serverBlock keeps it browser-only from now on.
    if (!refused) {
      logger.error(
        code,
        `Remote component ${d.remote}:${expose} (build ${d.buildId}) failed to load on the ${env}; rendering its fallback.`,
        last
      )
    }
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

  /** serverBlock, against the share cache of scope `s`. */
  function serverBlockIn(
    d: RemoteComponentDescriptor,
    s: ServerScope | null
  ): ServerBlock | null {
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
    // The server loader refused this build in this layer (it warned).
    const refused = refusal(d.base)
    if (refused) return refused
    // This runtime's own share cache (its scope): another layer's React
    // never lands in it. Kept as a check before evaluating server code.
    const holder = (s?.globals ?? globalThis) as {
      __mf_module_cache__?: ModuleCache
    }
    // A `@module-federation/vite` build (known once the loader checked its
    // manifest) whose range excludes the host's copy, which the cache holds
    // under its key: it would render the host's copy here and its own in
    // the browser, so it renders in the browser only (checked again after
    // the first load). A build with its own runtime never reads this cache.
    const viteBuild = s?.builds.get(d.base)?.bundlesRuntime === false
    const stale =
      staleSharedModule(deps.react, provided, holder) ??
      staleFallbackCopy(d, versions, provided, holder) ??
      (viteBuild ? hostCopyOutOfRange(d, versions, provided, holder) : null)
    if (stale === 'react') {
      warnOnce(
        'react',
        'The Module Federation share cache of this remote component runtime holds another React: remote components render in the browser only here.'
      )
      return 'react'
    }
    if (stale) {
      warnOnce(
        `stale:${stale}`,
        `The Module Federation share cache of this remote component runtime holds another instance of "${stale}" (two copies are installed, one was registered twice, or a fallback copy was cached before the host registered its own): remote components render in the browser only here.`
      )
      return 'stale'
    }
    return null
  }

  return {
    registerShared(shared) {
      assertVersions(shared)
      const added = Object.keys(shared).some((name) => !provided.has(name))
      for (const [name, { version, module }] of Object.entries(shared)) {
        provided.set(name, module)
        versions.set(name, version)
      }
      extraShared.push(shared)
      if (!instance) return
      if (added) {
        // A container initialised its share scope once, before this module
        // existed (for example a page that loaded another remote component
        // first, then a client navigation): it would never see it. Start
        // over: the next load gets a new instance with every module, and
        // registers its remote again (as after a timed-out load).
        startOver()
      } else {
        instance.registerShared(toMfShared(shared))
      }
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
      if (scope) loadScopes.set(p, scope)
      exposes.set(expose, p)
      return p
    },

    serverBlock(d) {
      return serverBlockIn(d, scope)
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
      // A stale cache of this runtime ('react' or 'stale') blocks before any
      // load. That is also the one case where a satisfying fallback copy
      // cannot be seeded, so server and browser never render different
      // copies (each router layer seeds its own scope).
      // A stale fallback copy in this scope's cache (cached before the host
      // registered its own, or a module registered again): a new scope, so
      // the server renders the host copy the browser seeds.
      if (
        scope &&
        !refusal(d.base) &&
        staleFallbackCopy(d, versions, provided, cacheHolder()) !== null &&
        !renewScope()
      ) {
        blocked.set(d.base, 'scopes')
        warnOnce(
          `scopes:${d.base}`,
          `Build "${d.buildId}" of "${d.remote}" found a stale fallback copy again after ${MAX_SCOPES} fresh scopes in this server layer: it renders in the browser only here.`
        )
      }
      const ready = (state: 'loaded' | 'refused') =>
        (componentTrustRegistry().serverReady ??= new Map()).set(d.base, state)
      if (this.serverBlock(d)) {
        result = resolved(null)
        ready('refused')
      } else {
        const load = this.load(d, expose)
        // Checked again once loaded, against the scope the module was loaded
        // in: another instance of a host module may have reached it.
        const from = loadScopes.get(load) ?? scope
        const after = (mod: RemoteModule): RemoteModule | null => {
          const blockedNow = serverBlockIn(d, from) !== null
          ready(blockedNow ? 'refused' : 'loaded')
          return blockedNow ? null : mod
        }
        // A load the loader refused: recorded at once, so a static
        // regeneration is not deferred for it again.
        const failed = (): null => {
          if (refusal(d.base)) ready('refused')
          return null
        }
        if (load.status === 'fulfilled') {
          result = resolved(after(load.value!))
        } else if (load.status === 'rejected') {
          result = resolved(failed())
        } else {
          result = load.then(after, failed) as Thenable<RemoteModule | null>
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
