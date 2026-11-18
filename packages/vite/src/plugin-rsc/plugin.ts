import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NFError, logger } from '@next-federation/sdk'
import rsc from '@vitejs/plugin-rsc'
import { normalizePath } from 'vite'
import type { Plugin, ResolvedConfig } from 'vite'
import {
  assertNoFastRefresh,
  findRawFormActions,
  findServerActions,
  hasFileLevelUseServer,
} from '../checks.ts'
import { codeLiteral } from '../code-literal.ts'
import { devCorsMiddleware } from '../dev-cors.ts'
import { resolveOptions } from '../options.ts'
import type { IslandRemoteOptions, ResolvedOptions } from '../options.ts'
import { islandSharePlugin, packageVersionReader } from '../share.ts'
import { remoteViteConfig, rscPluginOptions } from './config.ts'
import { registerDevActions } from './dev-actions.ts'
import { islandCssPlugin } from './island-css.ts'
import { flightScopePlugin } from './scope.ts'
import {
  assertFlightClientInstalled,
  assertFlightClientPatched,
  assertInstalledPluginRsc,
} from './version.ts'
import {
  VIRTUAL_BOOTSTRAP,
  VIRTUAL_CONFIG,
  VIRTUAL_ISLANDS,
} from './virtual.ts'

/** Written next to the environment folders of every build. */
export type BuildInfo = {
  name: string
  buildId: string
  builtAt: number
  base: string
}

// This package's own entries: `.tsx` sources when run from `src`, `.js` from `dist`.
const here = dirname(fileURLToPath(import.meta.url))
const ext = extname(fileURLToPath(import.meta.url)) === '.ts' ? '.tsx' : '.js'
const entry = (name: string): string =>
  normalizePath(join(here, `entry.${name}${ext}`))

export const ENTRIES: { rsc: string; ssr: string; client: string } = {
  rsc: entry('rsc'),
  ssr: entry('ssr'),
  client: entry('client'),
}
/** The module the client entry re-exports `mountIsland` from. */
export const CLIENT_BOOTSTRAP: string = normalizePath(
  join(here, `bootstrap.client${ext}`)
)

const JS_MODULE = /\.[cm]?[jt]sx?$/
// Third-party code (next-federation's own included) is not warned about.
const NO_FORM_WARNING = /\/node_modules\/|@next-federation/

const importedByClient = (file: string, env: string, importer?: string) =>
  new NFError(
    'NF-034',
    `${file} starts with 'use server' and is imported by ${importer ?? 'a client module'} (${env} environment). Import it in a Server Component and pass the action to the client component as a prop.`
  )

type GraphNode = { importers: Set<{ file: string | null }> }

type ImporterLookup = {
  getModuleInfo?: (id: string) => { importers?: readonly string[] } | null
  environment: {
    name: string
    mode?: string
    moduleGraph?: {
      getModuleById(id: string): GraphNode | undefined
      getModulesByFile?(file: string): Set<GraphNode> | undefined
    }
  }
}

function firstImporter(ctx: ImporterLookup, id: string): string | undefined {
  // Dev: the module graph (Vite's dev ModuleInfo throws on `.importers`). The
  // id may carry a query, so every module of the file is looked at.
  const graph = ctx.environment.moduleGraph
  const nodes = [
    graph?.getModuleById(id),
    ...(graph?.getModulesByFile?.(id.split('?')[0]!) ?? []),
  ]
  for (const node of nodes) {
    for (const importer of node?.importers ?? []) {
      if (importer.file) return importer.file
    }
  }
  try {
    return ctx.getModuleInfo?.(id)?.importers?.[0]
  } catch {
    return undefined
  }
}

function checksPlugin(serverActionFiles: Set<string>): Plugin {
  // Build: 'use server' files reached from client/ssr, per environment. The
  // importer is often unknown while the file is transformed, so the error is
  // raised at buildEnd, when the module graph is complete.
  const pending = new Map<string, Map<string, string>>()
  return {
    name: 'nf:checks',
    // Before plugin-rsc's 'use server' transform removes the directive.
    enforce: 'pre',
    configResolved(config) {
      assertNoFastRefresh(config.plugins.map((p) => p.name))
    },
    transform: {
      filter: { id: { exclude: /^\0/ } },
      handler(code, id) {
        const file = id.split('?')[0]!
        if (!JS_MODULE.test(file)) return undefined
        if (this.environment.name === 'rsc') {
          // The dev allowlist of files whose ids the action route may load.
          if (findServerActions(code, file)) serverActionFiles.add(file)
          else serverActionFiles.delete(file)
        } else if (hasFileLevelUseServer(code, file)) {
          // plugin-rsc would turn it into references on the page-global
          // callServer, which crosses islands and builds (finding F2).
          const env = this.environment.name
          const importer = firstImporter(this as unknown as ImporterLookup, id)
          // Dev has no buildEnd per request: fail now, importer or not.
          if (importer || this.environment.mode === 'dev') {
            throw importedByClient(file, env, importer)
          }
          let files = pending.get(env)
          if (!files) pending.set(env, (files = new Map()))
          files.set(id, file)
        }
        if (!NO_FORM_WARNING.test(file)) {
          const lines = findRawFormActions(code, file)
          if (lines.length > 0) {
            logger.warnOnce(
              'NF-035',
              file,
              `${file}:${lines.join(',')} passes an action to a plain <form action> or formAction. Use <Form> from @next-federation/island, which stays disabled until the island has hydrated.`
            )
          }
        }
        return undefined
      },
    },
    buildEnd() {
      const env = this.environment.name
      const files = pending.get(env)
      pending.delete(env)
      for (const [id, file] of files ?? []) {
        throw importedByClient(
          file,
          env,
          firstImporter(this as unknown as ImporterLookup, id)
        )
      }
    },
  }
}

function serverConfigModule(resolved: ResolvedOptions): string {
  return `export default ${codeLiteral(resolved)}\n`
}

// The browser bundle only needs these; issuers and hosts stay on the server.
function clientConfigModule(resolved: ResolvedOptions): string {
  const { name, buildId, publicBase, scopeKey, mode, actionTimeoutMs } =
    resolved
  return `export default ${codeLiteral({
    name,
    buildId,
    publicBase,
    scopeKey,
    mode,
    ...(actionTimeoutMs === null ? {} : { actionTimeoutMs }),
  })}\n`
}

function islandsModule(
  resolved: ResolvedOptions,
  config: ResolvedConfig
): string {
  const lines = Object.entries(resolved.islands).map(([name, island]) => {
    const file = normalizePath(resolve(config.root, island.entry))
    return `  ${codeLiteral(name)}: { load: () => import(${codeLiteral(file)}), private: ${island.private} },`
  })
  return `export default {\n${lines.join('\n')}\n}\n`
}

/**
 * Builds a next-federation island remote on top of `@vitejs/plugin-rsc`:
 * `<outDir>/{client,ssr,rsc}` plus `<outDir>/nf-build.json`. `rsc/index.js`
 * default-exports the island handler; the client entry exports `mountIsland`.
 */
export function nextFederationIslands(options: IslandRemoteOptions): Plugin[] {
  assertInstalledPluginRsc(process.env)
  // Validates the options up front (islands do not depend on the command).
  const { islands } = resolveOptions(options, {
    command: 'build',
    env: process.env,
    now: Date.now(),
    // Versions are read once the Vite root is known (config hook).
    readVersion: () => '0.0.0',
    // The http policy depends on the command: checked in the config hook.
    development: true,
  })
  let resolved: ResolvedOptions | undefined
  let viteConfig: ResolvedConfig | undefined
  const serverActionFiles = new Set<string>()
  let builtAt = 0
  const current = (): ResolvedOptions => {
    if (!resolved) {
      throw new NFError('NF-002', 'next-federation options were not resolved.')
    }
    return resolved
  }

  const resolvedIds = new Map([
    [VIRTUAL_CONFIG, `\0${VIRTUAL_CONFIG}`],
    [VIRTUAL_ISLANDS, `\0${VIRTUAL_ISLANDS}`],
    [VIRTUAL_BOOTSTRAP, `\0${VIRTUAL_BOOTSTRAP}`],
  ])

  const configPlugin: Plugin = {
    name: 'nf:config',
    // Before plugin-rsc's config hook, which reads the environment outDirs.
    enforce: 'pre',
    config(user, env) {
      const root = resolve(user.root ?? process.cwd())
      assertFlightClientInstalled(root)
      assertFlightClientPatched(root, env.command)
      builtAt = Date.now()
      resolved = resolveOptions(options, {
        command: env.command,
        env: process.env,
        now: builtAt,
        // Checked again, as Vite resolves them, when the client build starts.
        readVersion: packageVersionReader(root),
      })
      return remoteViteConfig(resolved, user)
    },
    configResolved(config) {
      viteConfig = config
      // A non-production build bundles React's development copies: sharing
      // them with production remotes of the same version would mix the two.
      if (!config.isProduction && resolved) resolved.share = null
    },
    configureServer(server) {
      // Registered before Vite's internal middlewares (and plugin-rsc's handler).
      const { hosts, publicBase, scopeKey } = current()
      registerDevActions(
        scopeKey,
        normalizePath(viteConfig?.root ?? process.cwd()),
        serverActionFiles
      )
      server.middlewares.use(
        devCorsMiddleware(hosts, new URL(publicBase).pathname)
      )
    },
    resolveId: {
      filter: { id: /^virtual:next-federation\// },
      handler(id) {
        return resolvedIds.get(id)
      },
    },
    load: {
      filter: { id: /^\0virtual:next-federation\// },
      handler(id) {
        const opts = current()
        if (id === resolvedIds.get(VIRTUAL_CONFIG)) {
          return this.environment.name === 'client'
            ? clientConfigModule(opts)
            : serverConfigModule(opts)
        }
        if (id === resolvedIds.get(VIRTUAL_ISLANDS)) {
          return islandsModule(opts, viteConfig!)
        }
        if (id === resolvedIds.get(VIRTUAL_BOOTSTRAP)) {
          return `export { mountIsland } from ${codeLiteral(ENTRIES.client)}\n`
        }
        return undefined
      },
    },
    // After plugin-rsc's buildApp has built every environment, so a failed
    // build never leaves an nf-build.json behind for nf-serve to pick up.
    buildApp: {
      order: 'post',
      async handler(builder) {
        const opts = current()
        const outDir = resolve(builder.config.root, opts.outDir)
        const info: BuildInfo = {
          name: opts.name,
          buildId: opts.buildId,
          builtAt,
          base: opts.publicBase,
        }
        await mkdir(outDir, { recursive: true })
        // Node < 22 loads `rsc/index.js` as CommonJS unless the nearest
        // package.json says "type": "module" (e.g. when only this folder is
        // deployed), so the build carries its own.
        await writeFile(
          join(outDir, 'package.json'),
          `${JSON.stringify({ type: 'module' })}\n`
        )
        await writeFile(
          join(outDir, 'nf-build.json'),
          `${JSON.stringify(info, null, 2)}\n`
        )
      },
    },
  }

  return [
    ...rsc(rscPluginOptions(ENTRIES)),
    flightScopePlugin(() => current().scopeKey),
    checksPlugin(serverActionFiles),
    islandCssPlugin(islands),
    islandSharePlugin({
      options: current,
      clientEntry: ENTRIES.client,
      clientBootstrap: CLIENT_BOOTSTRAP,
    }),
    configPlugin,
  ]
}
