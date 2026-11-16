import { NFError, logger } from '@next-federation/sdk'
import { parseSync } from 'vite'
import { SUPPORTED_PLUGIN_RSC_VERSION } from './plugin-rsc/constants.ts'

/**
 * NF-025 unless `version` is exactly the pinned plugin-rsc version. With
 * `NF_ALLOW_PLUGIN_RSC=1` (the CI canary job only) it logs NF-025 as a warning
 * and lets the build go on.
 */
export function assertPluginRscVersion(
  version: string,
  env: Record<string, string | undefined>
): void {
  if (version === SUPPORTED_PLUGIN_RSC_VERSION) return
  const detail = `Found @vitejs/plugin-rsc ${version}; @next-federation/vite supports exactly ${SUPPORTED_PLUGIN_RSC_VERSION}.`
  if (env.NF_ALLOW_PLUGIN_RSC === '1') {
    logger.warn('NF-025', `${detail} Continuing because NF_ALLOW_PLUGIN_RSC=1.`)
    return
  }
  throw new NFError('NF-025', detail)
}

// @vitejs/plugin-react's Babel and Fast Refresh plugins (6.x names), and
// @vitejs/plugin-react-swc (`vite:react-swc`, `vite:react-swc:resolve-runtime`).
const FAST_REFRESH_PLUGIN =
  /^vite:react(-refresh|-babel|:refresh|-virtual-preamble|-swc)/

/**
 * NF-002 if a Fast Refresh plugin is installed: its code expects a preamble
 * that only Vite-served pages have, so island modules loaded into a host would
 * fail (phase 0 finding 5).
 */
export function assertNoFastRefresh(pluginNames: readonly string[]): void {
  const found = pluginNames.find((name) => FAST_REFRESH_PLUGIN.test(name))
  if (found) {
    throw new NFError(
      'NF-002',
      `Remove @vitejs/plugin-react / @vitejs/plugin-react-swc (found plugin "${found}"): island remotes compile JSX without Fast Refresh, which cannot run inside a host page.`
    )
  }
}

type Node = { type?: unknown; directive?: unknown }

/**
 * True when `code` has a file-level or function-level `'use server'`
 * directive. Parses the module (oxc, via Vite), so a `'use server'` string
 * anywhere else (an expression, a comment, a template, a later statement) is
 * not a directive. `filename` picks the syntax (`.js`, `.jsx`, `.ts`, `.tsx`).
 * Code that does not parse returns false; the compiler reports it.
 */
export function findServerActions(
  code: string,
  filename = 'module.tsx'
): boolean {
  if (!code.includes('use server')) return false
  const { program, errors } = parseSync(filename, code)
  if (errors.length > 0) return false
  const stack: unknown[] = [program]
  while (stack.length > 0) {
    const value = stack.pop()
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item)
    } else if (value !== null && typeof value === 'object') {
      const node = value as Node
      // oxc sets `directive` only on directive-prologue statements of a
      // Program or a function body.
      if (
        node.type === 'ExpressionStatement' &&
        node.directive === 'use server'
      )
        return true
      for (const child of Object.values(value)) {
        if (child !== null && typeof child === 'object') stack.push(child)
      }
    }
  }
  return false
}

/**
 * True when the module's own directive prologue holds `'use client'` (only
 * the top of the file counts, as for React). Code that does not parse returns
 * false; the compiler reports it.
 */
export function hasUseClientDirective(
  code: string,
  filename = 'module.tsx'
): boolean {
  if (!code.includes('use client')) return false
  const { program, errors } = parseSync(filename, code)
  if (errors.length > 0) return false
  for (const statement of program.body as Node[]) {
    if (statement.type !== 'ExpressionStatement') break
    if (typeof statement.directive !== 'string') break
    if (statement.directive === 'use client') return true
  }
  return false
}
