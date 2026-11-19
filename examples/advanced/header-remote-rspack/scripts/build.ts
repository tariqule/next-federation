// `pnpm build`: the browser and server builds (rspack.config.ts), then
// nf-describe, which records the server entry in mf-manifest.json and writes
// the build's descriptor, signed with NF_COMPONENTS_SIGNING_KEY. The same as:
//   NF_BUILD_ID=<id> rspack build
//   nf-describe --dir dist/<id> --ssr-entry server/remoteEntry.js
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { rspack } from '@rspack/core'
import type { Configuration } from '@rspack/core'

const root = join(import.meta.dirname, '..')
// The demo signing key, from `pnpm examples:keys` (git-ignored). In
// production it is a secret of this remote's CI build only.
const envFile = join(root, '.env.local')
if (existsSync(envFile)) process.loadEnvFile(envFile)

function run(configs: Configuration[]): Promise<void> {
  return new Promise((resolve, reject) => {
    rspack(configs, (error, stats) => {
      if (error) return reject(error)
      if (stats?.hasErrors()) {
        return reject(new Error(stats.toString({ all: false, errors: true })))
      }
      resolve()
    })
  })
}

const { browser, server } = await import('../rspack.config.ts')
await run([browser, server])
// dist/<buildId>: the folder of this build (client/ is inside it).
const buildDir = dirname(browser.output!.path!)
execFileSync(
  join(root, 'node_modules', '.bin', 'nf-describe'),
  ['--dir', buildDir, '--ssr-entry', 'server/remoteEntry.js'],
  { stdio: 'inherit', env: process.env }
)
console.log(`header remote: built ${buildDir}`)
