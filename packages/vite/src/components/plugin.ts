import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { federation } from '@module-federation/vite'
import {
  COMPONENTS_DESCRIPTOR_FILE,
  COMPONENTS_DESCRIPTOR_PATH,
} from '@next-federation/protocol'
import type { ComponentBuildDescriptor } from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import type { Plugin, PluginOption, UserConfig } from 'vite'
import type { ComponentsBuildInfo } from '@next-federation/server/node'
import {
  collectBrowserAssets,
  collectServerIntegrity,
  createDescriptorFile,
} from './descriptor.ts'
import { resolveComponentsOptions } from './options.ts'
import type {
  ComponentsRemoteOptions,
  ResolvedComponentsOptions,
} from './options.ts'
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

function mfShared(resolved: ResolvedComponentsOptions) {
  return Object.fromEntries(
    Object.entries(resolved.shared).map(([name, { requiredVersion }]) => [
      name,
      // `import: false`: never bundled, always the host's copy.
      { singleton: true, requiredVersion, import: false as const },
    ])
  )
}

function viteConfig(resolved: ResolvedComponentsOptions): UserConfig {
  const client = `${resolved.outDir}/client`
  return {
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
 * Builds a next-federation **components** remote (Mode A): Module Federation
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
  let resolved = resolveComponentsOptions(options, {
    command,
    env: process.env,
    now: builtAt,
  })
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
    shared: mfShared(resolved),
  })
  const mf = Array.isArray(mfPlugins) ? mfPlugins : [mfPlugins]

  const nfPlugin: Plugin = {
    name: 'nf:components',
    enforce: 'pre',
    config(_user, env) {
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
      return viteConfig(resolved)
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

  return [nfPlugin, ...mf, refreshGuard]
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
