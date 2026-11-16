// Builds the Rspack remote: the browser copy, then the server copy (into the
// browser copy's `server/` folder), then `nf-describe` records the server
// entry in mf-manifest.json and writes the build's descriptor (signed when
// NF_COMPONENTS_SIGNING_KEY is set) and nf-build.json. A remote app runs the
// same steps as `rspack build && nf-describe --dir dist/<buildId> --ssr-entry server/remoteEntry.js`.
import { dirname } from 'node:path'
import { runDescribeCli } from '@next-federation/server/node'
import { rspack } from '@rspack/core'
import type { Configuration } from '@rspack/core'

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
// `rspack build` with this config does the same (server after browser).
await run([browser, server])
const buildDir = dirname(browser.output!.path!)
const code = await runDescribeCli(
  ['--dir', buildDir, '--ssr-entry', 'server/remoteEntry.js'],
  process.env,
  (line) => process.stderr.write(`${line}\n`)
)
if (code !== 0) process.exit(code)
