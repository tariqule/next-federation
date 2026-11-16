import { resolve } from 'node:path'
import { NFError } from '@next-federation/sdk'
import { normalizePath } from 'vite'
import type { Plugin } from 'vite'
import { hasUseClientDirective } from '../checks.ts'
import type { ResolvedOptions } from '../options.ts'
import { ISLAND_CSS_EXPORT } from './constants.ts'

export { ISLAND_CSS_EXPORT }

const LOAD_CSS = 'import.meta.viteRsc.loadCss'
const APPENDED = `\nexport const ${ISLAND_CSS_EXPORT} = () => ${LOAD_CSS}()\n`

/**
 * Gives every island module exactly one `import.meta.viteRsc.loadCss()` call,
 * exported as `__nf_css`. plugin-rsc 0.5.39 wires only the FIRST `loadCss`
 * call per module in builds (phase 0 finding 8), so one call per island module
 * is the only shape that works, and a module that already calls it is
 * rejected: its call would be the wired one and ours would break.
 *
 * An island entry marked `'use client'` is rejected too (NF-002): plugin-rsc
 * would turn the module, and so the appended export, into a client reference,
 * and the island would render nothing on the remote server.
 */
export function islandCssPlugin(islands: ResolvedOptions['islands']): Plugin {
  let entries = new Set<string>()
  return {
    name: 'nf:island-css',
    enforce: 'pre',
    applyToEnvironment: (environment) => environment.name === 'rsc',
    configResolved(config) {
      entries = new Set(
        Object.values(islands).map((island) =>
          normalizePath(resolve(config.root, island.entry))
        )
      )
    },
    transform: {
      handler(code, id) {
        const file = normalizePath(id.split('?')[0]!)
        if (!entries.has(file)) return undefined
        if (code.includes(APPENDED)) return undefined
        if (hasUseClientDirective(code, file)) {
          throw new NFError(
            'NF-002',
            `${id} is an island entry but starts with 'use client'. Island entries are Server Components: move the 'use client' code into a component the island renders.`
          )
        }
        if (code.includes(LOAD_CSS)) {
          throw new NFError(
            'NF-002',
            `${id} calls ${LOAD_CSS}() itself. Remove it: next-federation collects each island's CSS for the envelope.`
          )
        }
        return { code: code + APPENDED, map: null }
      },
    },
  }
}
