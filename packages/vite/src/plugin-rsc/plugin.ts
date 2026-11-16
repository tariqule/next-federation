import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NFError } from '@next-federation/sdk'
import rsc from '@vitejs/plugin-rsc'
import { normalizePath } from 'vite'
import type { Plugin, ResolvedConfig } from 'vite'
import { assertNoFastRefresh, findServerActions } from '../checks.ts'
import { devCorsMiddleware } from '../dev-cors.ts'
import { resolveOptions } from '../options.ts'
import type { IslandRemoteOptions, ResolvedOptions } from '../options.ts'
import { islandSharePlugin, packageVersionReader } from '../share.ts'
import { remoteViteConfig, rscPluginOptions } from './config.ts'
import { islandCssPlugin } from './island-css.ts'
import { flightScopePlugin } from './scope.ts'
import { assertInstalledPluginRsc } from './version.ts'
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

function checksPlugin(): Plugin {
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
        if (findServerActions(code, file)) {
          throw new NFError(
            'NF-019',
            `${id} uses 'use server'. Server Actions are not supported by next-federation islands in this release.`
          )
        }
        return undefined
      },
    },
  }
}

function serverConfigModule(resolved: ResolvedOptions): string {
  return `export default ${JSON.stringify(resolved)}\n`
}

// The browser bundle only needs these; issuers and hosts stay on the server.
function clientConfigModule(resolved: ResolvedOptions): string {
  const { name, buildId, publicBase, scopeKey, mode } = resolved
  return `export default ${JSON.stringify({ name, buildId, publicBase, scopeKey, mode })}\n`
}

function islandsModule(
  resolved: ResolvedOptions,
  config: ResolvedConfig
): string {
  const lines = Object.entries(resolved.islands).map(([name, island]) => {
    const file = normalizePath(resolve(config.root, island.entry))
    return `  ${JSON.stringify(name)}: { load: () => import(${JSON.stringify(file)}), private: ${island.private} },`
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
      builtAt = Date.now()
      resolved = resolveOptions(options, {
        command: env.command,
        env: process.env,
        now: builtAt,
        // Checked again, as Vite resolves them, when the client build starts.
        readVersion: packageVersionReader(resolve(user.root ?? process.cwd())),
      })
      return remoteViteConfig(resolved)
    },
    configResolved(config) {
      viteConfig = config
      // A non-production build bundles React's development copies: sharing
      // them with production remotes of the same version would mix the two.
      if (!config.isProduction && resolved) resolved.share = null
    },
    configureServer(server) {
      // Registered before Vite's internal middlewares (and plugin-rsc's handler).
      const { hosts, publicBase } = current()
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
          return `export { mountIsland } from ${JSON.stringify(ENTRIES.client)}\n`
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
    checksPlugin(),
    islandCssPlugin(islands),
    islandSharePlugin({
      options: current,
      clientEntry: ENTRIES.client,
      clientBootstrap: CLIENT_BOOTSTRAP,
    }),
    configPlugin,
  ]
}
