import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { federation } from '@module-federation/vite'
import {
  COMPONENTS_DESCRIPTOR_FILE,
  COMPONENTS_DESCRIPTOR_PATH,
  satisfies,
} from '@next-federation/protocol'
import type { ComponentBuildDescriptor } from '@next-federation/protocol'
import { NFError, logger } from '@next-federation/sdk'
import {
  reactRouterDirectory,
  routerShimAliases,
  routerShimFile,
} from '@next-federation/router/build'
import type { Alias, Plugin, PluginOption, Rolldown, UserConfig } from 'vite'
import {
  SHARED_USAGE_FILE,
  readSharedUsage,
  sharedFromManifest,
  writeTypesIndex,
} from '@next-federation/server/node'
import type { ComponentsBuildInfo } from '@next-federation/server/node'
import {
  collectBrowserAssets,
  collectServerIntegrity,
  createDescriptorFile,
} from './descriptor.ts'
import {
  HOST_REACT,
  ROUTER_PACKAGE,
  resolveComponentsOptions,
} from './options.ts'
import type {
  ComponentsRemoteOptions,
  ResolvedComponentsOptions,
} from './options.ts'
import { collectSharedUsage, mfSharedConfig } from './shared.ts'
import { emitBuildTypes, loadTypeScript } from './types.ts'
import {
  assertModuleFederationViteVersion,
  installedModuleFederationViteVersion,
} from './version.ts'

/** Written next to `client/` in every components build (nf-serve reads it). */
export type { ComponentsBuildInfo }

const VIRTUAL_ENTRY = 'virtual:next-federation/components-entry'
const RESOLVED_ENTRY = `\0${VIRTUAL_ENTRY}`
// Fast Refresh registration calls: a host page has no Vite preamble for them.
const FAST_REFRESH_MARKER = /\$RefreshReg\$|\$RefreshSig\$/
// Module Federation's virtual module for the shared `@next-federation/router`
// (its share proxy): a `\0virtual:mf:` id (Rollup's mark for a module that is
// no file) naming that package (`@` `-` `/` encoded as `_mf_0_` `_mf_2_` `_mf_1_`).
const SHARE_MODULE =
  /^\0virtual:mf:[^/\\]*__loadShare___mf_0_next_mf_2_federation_mf_1_router__loadShare__[^/\\]*$/

/**
 * `next/link` and `next/navigation`, rewired to the shims of this plugin's
 * own `@next-federation/router` (exact matches only), unless `links: false`.
 * A specifier the user lists in `shared` keeps its sharing. React Router is
 * rewired in `resolveId` (see `rewiresReactRouter`).
 */
export function routerAliases(
  resolved: Pick<ResolvedComponentsOptions, 'links' | 'shared'>
): Record<string, string> {
  if (!resolved.links) return {}
  const aliases = routerShimAliases()
  // Not the router itself: Module Federation turns that import into its
  // share proxy (`ownRouter` names the bundled file).
  delete aliases[`${ROUTER_PACKAGE}$`]
  for (const key of Object.keys(aliases)) {
    if (key.slice(0, -1) in resolved.shared) delete aliases[key]
  }
  return aliases
}

/** The specifiers rewired to the React Router shim, as one group. */
const REACT_ROUTER = ['react-router', 'react-router-dom']
/** The name the shim imports the real package by. */
const REAL_REACT_ROUTER = '@next-federation/router/real-react-router'
/** The React Router the shim is written for. */
const REACT_ROUTER_RANGE = '>=7.0.0 <8'

/**
 * `react-router` and `react-router-dom`, those the root's own package.json
 * declares (dependencies, devDependencies or peerDependencies).
 */
function declaredReactRouter(root: string): string[] {
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    ) as Record<string, unknown>
  } catch {
    return []
  }
  return REACT_ROUTER.filter((name) =>
    ['dependencies', 'devDependencies', 'peerDependencies'].some((field) => {
      const deps = manifest[field]
      return (
        typeof deps === 'object' && deps !== null && Object.hasOwn(deps, name)
      )
    })
  )
}

/**
 * Whether `react-router` and `react-router-dom` may go to the React Router
 * shim: links on, the root's own package.json declares one of them, and
 * neither is listed in `shared` (half of the group rewired would bundle a
 * second React Router). The build rewires them only when, in addition,
 * `react-router` 7 resolves from the remote's source (see the shim plugin).
 */
export function rewiresReactRouter(
  resolved: Pick<ResolvedComponentsOptions, 'links' | 'shared'>,
  root: string
): boolean {
  if (!resolved.links) return false
  if (REACT_ROUTER.some((name) => name in resolved.shared)) return false
  return declaredReactRouter(root).length > 0
}

/**
 * The version of the `react-router` package a resolved file belongs to (the
 * nearest package.json named `react-router` above it), or null.
 */
function reactRouterVersionOf(id: string): string | null {
  const file = id.split('?')[0]!
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8')
      ) as { name?: unknown; version?: unknown }
      if (pkg.name === 'react-router') {
        return typeof pkg.version === 'string' ? pkg.version : null
      }
    } catch {
      // no package.json here: one folder up
    }
    if (dirname(dir) === dir) return null
  }
}

/** The nearest `node_modules/<name>` of `from` or a parent folder. */
function packageDirectory(from: string, name: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    try {
      return realpathSync(candidate)
    } catch {
      // not here: one folder up
    }
    if (dirname(dir) === dir) return null
  }
}

/**
 * The packages a server build bundles for the React Router shim, by name:
 * `react-router`, `react-router-dom` and the packages React Router depends
 * on (`dependencies`, transitively; peers such as React stay shared). Vite
 * leaves node_modules packages out of a server build (a `require`), and a
 * host's server loader refuses that require (NF-030), so the remote's
 * React Router components could only render in the browser. Names only:
 * which files are bundled stays Vite's own resolution.
 */
export function reactRouterServerPackages(root: string): string[] {
  const start = reactRouterDirectory(root)
  // Not React Router 7 from the root: the build leaves React Router alone.
  const version = start && reactRouterVersionOf(join(start, 'package.json'))
  if (!version || !satisfies(version, REACT_ROUTER_RANGE)) return []
  const names = new Set(REACT_ROUTER)
  const queue: string[] = [start]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const dir = queue.shift()!
    if (seen.has(dir)) continue
    seen.add(dir)
    let manifest: { dependencies?: Record<string, string> }
    try {
      manifest = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8')
      ) as typeof manifest
    } catch {
      continue
    }
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (HOST_REACT.includes(name)) continue
      names.add(name)
      // Node's lookup from the package's own folder: its node_modules, then
      // every parent's (next to it in pnpm's layout, hoisted otherwise).
      const found = packageDirectory(dir, name)
      if (found) queue.push(found)
    }
  }
  return [...names]
}

/** `{ 'next/link$': file }` as Vite aliases (exact matches). */
function toViteAliases(aliases: Record<string, string>): Alias[] {
  return Object.entries(aliases).map(([key, replacement]) => ({
    find: new RegExp(
      `^${key.slice(0, -1).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`
    ),
    replacement,
  }))
}

function viteConfig(
  resolved: ResolvedComponentsOptions,
  user: UserConfig,
  aliases: Record<string, string>,
  serverPackages: string[]
): UserConfig {
  const client = `${resolved.outDir}/client`
  return {
    resolve: { alias: toViteAliases(aliases) },
    // Vite 8 can forward browser console output to the dev server's
    // terminal: for a remote that is every host page's console. Off, unless
    // the remote's own config sets it.
    ...(user.server?.forwardConsole === undefined
      ? { server: { forwardConsole: false } }
      : {}),
    base: resolved.publicBase,
    // `vite build` builds every environment (the browser and the server copy).
    builder: {},
    build: {
      outDir: client,
      emptyOutDir: true,
      target: 'esnext',
      rollupOptions: { input: VIRTUAL_ENTRY },
    },
    environments: {
      client: {},
      ...(resolved.ssr && {
        ssr: {
          // Bundled, never required (see reactRouterServerPackages).
          ...(serverPackages.length > 0 && {
            resolve: { noExternal: serverPackages },
          }),
          build: {
            // Scratch output: Module Federation copies the server entry and
            // its chunks next to the browser build, which is what is served.
            outDir: `${resolved.outDir}/.ssr`,
            emptyOutDir: true,
            rollupOptions: {
              input: VIRTUAL_ENTRY,
              output: { format: 'cjs' },
            },
          },
        },
      }),
    },
  }
}

/**
 * A browser navigating to a page of the project: a document request
 * (`Sec-Fetch-Dest: document`, or an HTML `Accept` from a client that does not
 * send it) for a path that is not a file. A tab opened on `/mf-manifest.json`,
 * the descriptor or a module is not a page.
 */
function isPageRequest(req: {
  url?: string
  headers: Record<string, string | string[] | undefined>
}): boolean {
  const dest = req.headers['sec-fetch-dest']
  const accept = req.headers.accept
  const document =
    dest === undefined
      ? typeof accept === 'string' && accept.includes('text/html')
      : dest === 'document'
  if (!document) return false
  const path = (req.url ?? '/').split(/[?#]/)[0]!
  const last = path.slice(path.lastIndexOf('/') + 1)
  return !last.includes('.') || last.endsWith('.html')
}

/**
 * Builds a next-federation **components** remote: Module Federation
 * client components that hosts render inside their own React tree, on the
 * host's React. Wraps `@module-federation/vite` (pinned, NF-026) and emits,
 * per build, `<outDir>/<buildId>/client/` (served under the immutable
 * `<base>b/<buildId>/`), `nf-build.json` and `nf-components.json`, the build
 * descriptor with the sha384 of every server chunk (signed when
 * `NF_COMPONENTS_SIGNING_KEY` is set). `nf-serve --dir <outDir>` serves it.
 */
export function nextFederationComponents(
  options: ComponentsRemoteOptions
): PluginOption[] {
  assertModuleFederationViteVersion(
    installedModuleFederationViteVersion(),
    process.env
  )
  // Vite resolves (and, for a linked plugin, re-bundles) the config once per
  // environment, so each environment gets a new plugin instance. The first
  // one fixes the build time and exports the default buildId (its base36
  // form, as for islands) as NF_BUILD_ID, so every later one agrees.
  const builtAt = Number(process.env.NF_COMPONENTS_BUILT_AT) || Date.now()
  process.env.NF_COMPONENTS_BUILT_AT ??= String(builtAt)
  // Module Federation takes its publicPath when its plugin is created, before
  // Vite tells plugins the command: read it from the CLI (`vite build`), or
  // from NF_VITE_COMMAND for programmatic builds. `config` checks the guess.
  const command = guessCommand(process.env, process.argv)
  // Module Federation's shared config is fixed now.
  let resolved = resolveComponentsOptions(options, {
    command,
    env: process.env,
    now: builtAt,
  })
  // The absolute shim files in use, and the React Router shim when React
  // Router is rewired (set in `config`).
  let shimFiles = new Set<string>()
  let reactRouterShim: string | null = null
  let viteRoot = process.cwd()
  if (command === 'build' && options.buildId === undefined) {
    process.env.NF_BUILD_ID ??= resolved.buildId
  }

  const mfPlugins = federation({
    name: resolved.name,
    filename: 'remoteEntry.js',
    manifest: true,
    // Absolute: chunks load from the remote's origin inside a host page.
    publicPath: resolved.publicBase,
    dts: false,
    exposes: resolved.exposes,
    shared: mfSharedConfig(resolved),
  })
  const mf = Array.isArray(mfPlugins) ? mfPlugins : [mfPlugins]

  const nfPlugin: Plugin = {
    name: 'nf:components',
    enforce: 'pre',
    config(user, env) {
      if (env.command !== command) {
        throw new NFError(
          'NF-002',
          `nextFederationComponents expected \`vite ${command}\` but Vite runs "${env.command}". Set NF_VITE_COMMAND=${env.command} for a programmatic ${env.command}.`
        )
      }
      resolved = resolveComponentsOptions(options, {
        command: env.command,
        env: process.env,
        now: builtAt,
      })
      viteRoot = resolve(user.root ?? process.cwd())
      const aliases = routerAliases(resolved)
      reactRouterShim = rewiresReactRouter(resolved, viteRoot)
        ? routerShimFile('react-router')
        : null
      shimFiles = new Set([
        ...Object.values(aliases),
        ...(reactRouterShim ? [reactRouterShim] : []),
      ])
      return viteConfig(
        resolved,
        user,
        aliases,
        reactRouterShim ? reactRouterServerPackages(viteRoot) : []
      )
    },
    resolveId: {
      filter: { id: /^virtual:next-federation\/components-entry$/ },
      handler() {
        return RESOLVED_ENTRY
      },
    },
    load: {
      filter: { id: /^\0virtual:next-federation\/components-entry$/ },
      handler() {
        // Only Module Federation's own entries matter; this keeps Vite happy.
        return 'export {}\n'
      },
    },
    configureServer(server) {
      // A browser opening a page of this project (a host only loads modules,
      // manifests and the descriptor): it cannot run here, since React and
      // every shared module are host-provided for the whole project.
      server.middlewares.use((req, _res, next) => {
        if (req.method === 'GET' && isPageRequest(req)) {
          logger.warnOnce(
            'NF-002',
            'components-dev-page',
            `${req.url ?? '/'} is a page of this Vite project, served by a components remote's dev server. nextFederationComponents makes react, react-dom and every \`shared\` module host-provided for the whole project, so no page of it runs on its own ("createContext is not a function", "module is not defined"). Keep a standalone app in its own Vite config, next to the remote's (vite.remote.config.ts): see docs/guides/remote-components/vite-remote.mdx#keep-a-standalone-app.`
          )
        }
        next()
      })
      // Dev: hosts render the remote in the browser only (no server build).
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== COMPONENTS_DESCRIPTOR_PATH) return next()
        const payload: ComponentBuildDescriptor = {
          v: 1,
          name: resolved.name,
          buildId: resolved.buildId,
          base: resolved.publicBase,
          manifest: `${resolved.publicBase}mf-manifest.json`,
          ssr: null,
        }
        void createDescriptorFile(payload, {}).then((file) => {
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.setHeader('access-control-allow-origin', '*')
          res.end(JSON.stringify(file))
        }, next)
      })
    },
    buildApp: {
      order: 'post',
      async handler(builder) {
        if (mf.length === 0) {
          // @module-federation/vite returns no plugins in a test environment.
          throw new NFError(
            'NF-002',
            '@module-federation/vite disables itself when NODE_ENV=test, VITEST or JEST_WORKER_ID is set, so this build would have no remote entry. Build outside the test environment, or set MFE_VITE_NO_TEST_ENV_CHECK=true.'
          )
        }
        // The browser build first: Module Federation copies the server entry
        // into its (emptied) folder while the server environment builds.
        for (const name of ['client', 'ssr']) {
          const environment = builder.environments[name]
          if (
            environment &&
            !environment.isBuilt &&
            (name === 'client' || resolved.ssr)
          ) {
            await builder.build(environment)
          }
        }
        const outDir = resolve(builder.config.root, resolved.outDir)
        const client = join(outDir, 'client')
        await rm(join(outDir, '.ssr'), { recursive: true, force: true })
        await rm(join(client, 'index.html'), { force: true })
        await emitBuildTypes({
          types: resolved.types,
          ts: resolved.types ? loadTypeScript(builder.config.root) : null,
          root: builder.config.root,
          exposes: resolved.exposes,
          clientDir: client,
        })
        const payload: ComponentBuildDescriptor = {
          v: 1,
          name: resolved.name,
          buildId: resolved.buildId,
          base: resolved.publicBase,
          manifest: `${resolved.publicBase}mf-manifest.json`,
          ssr: resolved.ssr
            ? { integrity: await collectServerIntegrity(client) }
            : null,
          // Signed with the payload: hosts may bound a build's age (ssr.maxAge).
          iat: Math.floor(builtAt / 1000),
          // Signed too: the only stylesheet and modulepreload URLs hosts render.
          assets: await collectBrowserAssets(client, resolved.publicBase),
        }
        // Signed too: what the host's shared modules must satisfy (NF-036).
        // The usage file stays next to the build: nf-describe reads it too.
        const shared = sharedFromManifest(
          JSON.parse(
            await readFile(join(client, 'mf-manifest.json'), 'utf8')
          ) as unknown,
          await readSharedUsage(outDir)
        )
        if (shared) payload.shared = shared
        // Signed too, with `types: true` only: the declarations index (hosts'
        // prop types). An `@mf-types/` folder alone is never published.
        if (resolved.types) {
          const types = await writeTypesIndex(client, resolved.publicBase)
          if (types) payload.types = types
        }
        const file = await createDescriptorFile(payload, process.env)
        const info: ComponentsBuildInfo = {
          kind: 'components',
          name: resolved.name,
          buildId: resolved.buildId,
          builtAt,
          base: resolved.publicBase,
        }
        await mkdir(outDir, { recursive: true })
        await writeFile(
          join(outDir, COMPONENTS_DESCRIPTOR_FILE),
          `${JSON.stringify(file, null, 2)}\n`
        )
        // Last: nf-serve only picks up a folder with nf-build.json.
        await writeFile(
          join(outDir, 'nf-build.json'),
          `${JSON.stringify(info, null, 2)}\n`
        )
      },
    },
  }

  // React Router: `react-router` and `react-router-dom` go to the shim, and
  // the shim's real package is what Vite itself resolves from the remote's
  // source (Vite's resolver and conditions, no Node global folders).
  //
  // A shim imports `@next-federation/router` from inside that package, which
  // Module Federation keeps as a plain import when the package is a
  // workspace link. Resolved as the remote's own import instead, so it is
  // the shared module (the host's copy, or this build's own). Only Module
  // Federation's share module is taken from that resolution: anything else
  // (a file found from the remote's root) is dropped, and the shim's import
  // resolves from the shim, in this plugin's own install.
  // Per environment: `react-router` as Vite resolves it from the remote's
  // source when it is React Router 7 (what the shim is written for), else
  // null (React Router is then left alone, with one warning).
  const reactRouterChecks = new Map<
    string,
    Promise<Rolldown.ResolvedId | null>
  >()
  const shimPlugin: Plugin = {
    name: 'nf:components-router-shims',
    enforce: 'pre',
    resolveId: {
      order: 'pre',
      async handler(source, importer, resolveOptions) {
        const from = importer?.split('?')[0]
        const asRemote = () => {
          const [expose] = Object.values(resolved.exposes)
          return resolve(viteRoot, expose!)
        }
        const reactRouter7 = (): Promise<Rolldown.ResolvedId | null> => {
          const key = this.environment?.name ?? ''
          let check = reactRouterChecks.get(key)
          if (!check) {
            check = this.resolve('react-router', asRemote(), {
              ...resolveOptions,
              skipSelf: true,
            }).then((real) => {
              const version = real ? reactRouterVersionOf(real.id) : null
              if (
                real &&
                version !== null &&
                satisfies(version, REACT_ROUTER_RANGE)
              ) {
                return real
              }
              const declared = declaredReactRouter(viteRoot).join(' and ')
              logger.warnOnce(
                'NF-002',
                `components-react-router:${viteRoot}`,
                `${join(viteRoot, 'package.json')} declares ${declared}, but ${version === null ? 'react-router does not resolve' : `the react-router that resolves is ${version}, not React Router 7,`} from ${viteRoot}: this build leaves react-router and react-router-dom imports as they are (links there navigate with the remote's own React Router, not the host's; next/link and next/navigation are still rewired). To rewire them, add react-router 7 as a direct dependency of the remote; set \`links: false\` to turn the rewiring (and this warning) off.`
              )
              return null
            })
            reactRouterChecks.set(key, check)
          }
          return check
        }
        if (
          reactRouterShim &&
          from !== reactRouterShim &&
          REACT_ROUTER.includes(source)
        ) {
          return (await reactRouter7()) ? reactRouterShim : null
        }
        if (
          reactRouterShim &&
          from === reactRouterShim &&
          source === REAL_REACT_ROUTER
        ) {
          const real = await reactRouter7()
          if (!real) {
            throw new NFError(
              'NF-002',
              `The React Router shim imports react-router 7, which does not resolve from ${viteRoot}. Add react-router 7 as a direct dependency, or set \`links: false\`.`
            )
          }
          return real
        }
        if (
          source !== ROUTER_PACKAGE ||
          !from ||
          !shimFiles.has(from) ||
          !(ROUTER_PACKAGE in resolved.shared)
        ) {
          return null
        }
        const shared = await this.resolve(source, asRemote(), {
          ...resolveOptions,
          skipSelf: true,
        })
        return shared && SHARE_MODULE.test(shared.id) ? shared : null
      },
    },
  }

  // Module id -> the shared specifiers it imports (browser build).
  const sharedImports = new Map<string, Set<string>>()
  const usagePlugin: Plugin = {
    name: 'nf:components-shared-usage',
    enforce: 'pre',
    apply: 'build',
    resolveId: {
      // Before Module Federation turns the import into its share proxy.
      order: 'pre',
      handler(source, importer) {
        if (!importer || this.environment.name !== 'client') return null
        const name = sharedNameOf(source, resolved.shared)
        if (name === null || HOST_REACT.includes(name)) return null
        const id = importer.split('?')[0]!
        let names = sharedImports.get(id)
        if (!names) sharedImports.set(id, (names = new Set()))
        names.add(name)
        return null
      },
    },
    generateBundle() {
      if (this.environment.name !== 'client') return
      const root = this.environment.config.root
      const usage = collectSharedUsage(
        Object.fromEntries(
          Object.entries(resolved.exposes).map(([key, file]) => [
            key,
            resolve(root, file),
          ])
        ),
        (id) => this.getModuleInfo(id),
        sharedImports
      )
      // Read once every environment is built (each environment may get its
      // own plugin instance), so it goes through a file next to the build.
      const outDir = resolve(root, resolved.outDir)
      mkdirSync(outDir, { recursive: true })
      writeFileSync(
        join(outDir, SHARED_USAGE_FILE),
        JSON.stringify(
          usage &&
            Object.fromEntries(
              [...usage].map(([expose, names]) => [expose, [...names]])
            )
        )
      )
    },
  }

  const exposed = new Set<string>()
  const refreshGuard: Plugin = {
    name: 'nf:components-no-fast-refresh',
    enforce: 'post',
    configResolved(config) {
      for (const file of Object.values(resolved.exposes)) {
        exposed.add(resolve(config.root, file))
      }
    },
    transform(code, id) {
      if (!exposed.has(id.split('?')[0]!)) return undefined
      if (FAST_REFRESH_MARKER.test(code)) {
        throw new NFError(
          'NF-002',
          `${id} is compiled with Fast Refresh, which cannot run inside a host page. Exclude exposed modules from @vitejs/plugin-react (its \`exclude\` option).`
        )
      }
      return undefined
    },
  }

  return [nfPlugin, usagePlugin, shimPlugin, ...mf, refreshGuard]
}

/** The `shared` key an import specifier names (itself or a subpath), or null. */
function sharedNameOf(
  source: string,
  shared: ResolvedComponentsOptions['shared']
): string | null {
  if (source in shared) return source
  let best: string | null = null
  for (const name of Object.keys(shared)) {
    if (
      source.startsWith(`${name}/`) &&
      (best === null || name.length > best.length)
    ) {
      best = name
    }
  }
  return best
}

/** `vite build` (CLI) or NF_VITE_COMMAND; anything else is the dev server. */
export function guessCommand(
  env: Record<string, string | undefined>,
  argv: readonly string[]
): 'build' | 'serve' {
  if (env.NF_VITE_COMMAND === 'build' || env.NF_VITE_COMMAND === 'serve') {
    return env.NF_VITE_COMMAND
  }
  return argv.slice(2).includes('build') ? 'build' : 'serve'
}

/** Reads a build's descriptor file (nf-serve and tests). */
export async function readDescriptorFile(dir: string): Promise<unknown> {
  return JSON.parse(
    await readFile(join(dir, COMPONENTS_DESCRIPTOR_FILE), 'utf8')
  ) as unknown
}
