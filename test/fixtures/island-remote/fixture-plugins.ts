// Fixture-only Vite plugins for the React sharing e2e.
import { join } from 'node:path'
import type { Plugin } from 'vite'

/** The copies the probe counts: each package entry React evaluates once per copy. */
const PROBED =
  /\/node_modules\/(react\/index|react-dom\/index|react-dom\/client)\.js$/
const PROBE_NAME: Record<string, string> = {
  'react/index': 'react',
  'react-dom/index': 'react-dom',
  'react-dom/client': 'react-dom/client',
}

/**
 * Runtime copy probe, production client builds only: every evaluation of a
 * bundled react, react-dom or react-dom/client copy in the browser pushes its
 * version onto `window.__probeReact[<name>]`. Names outside `__nf*`, so the
 * page-globals checks never see them. A copy the island takes from the share
 * scope is never evaluated, so it is never counted.
 */
export function reactProbePlugin(): Plugin {
  return {
    name: 'fixture:react-probe',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    transform: {
      filter: { id: PROBED },
      handler(code, id) {
        const name = PROBE_NAME[PROBED.exec(id.split('?')[0]!)![1]!]!
        // react-dom/client: the version of this copy's own react-dom (the
        // bundler may drop client's unused `version` export).
        const version =
          name === 'react-dom/client'
            ? "require('./index.js').version"
            : 'module.exports.version'
        return {
          code: `${code}
;((globalThis.__probeReact ??= {})[${JSON.stringify(name)}] ??= []).push(${version})
`,
          map: null,
        }
      },
    },
  }
}

/**
 * Old-React fixture: `react`, `react-dom` and `react-server-dom-webpack`
 * (with subpaths) resolve from `fixtureDir`'s own node_modules in every
 * environment, as if imported from a file there. A re-resolving plugin rather
 * than aliases, so export conditions such as `react-server` still apply.
 */
export function reactFromPlugin(fixtureDir: string): Plugin {
  const importer = join(fixtureDir, 'package.json')
  return {
    name: 'fixture:react-from',
    enforce: 'pre',
    resolveId: {
      filter: { id: /^(?:react|react-dom|react-server-dom-webpack)(?:\/|$)/ },
      handler(source, _importer, options) {
        return this.resolve(source, importer, { ...options, skipSelf: true })
      },
    },
  }
}
