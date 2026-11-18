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

const RSC_ADVISORY = 'GHSA-xqc2-xf4c-x3h3'
const RSC_ADVISORY_URL = `https://github.com/advisories/${RSC_ADVISORY}`
// The first patched patch release of each affected React 19 minor line.
const RSC_PATCHED: Readonly<Record<string, number>> = {
  '19.0': 9,
  '19.1': 10,
  '19.2': 9,
  '19.3': 1,
}

/**
 * The first patched release of `version`'s minor line when `version` is
 * affected by GHSA-xqc2-xf4c-x3h3 (unauthenticated remote code execution in
 * React Server Components), else null. A prerelease of an affected line below
 * its patched release counts as affected.
 */
export function patchedFlightClientVersion(version: string): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+.*)?$/.exec(version)
  if (!m) return null
  const line = `${m[1]}.${m[2]}`
  const fixed = RSC_PATCHED[line]
  if (fixed === undefined) return null
  const patch = Number(m[3])
  const affected = patch < fixed || (patch === fixed && m[4] !== undefined)
  return affected ? `${line}.${fixed}` : null
}

/**
 * NF-041 when the `react-server-dom-webpack` installed at `location` is
 * affected by GHSA-xqc2-xf4c-x3h3: an island remote runs it on its server.
 * A build fails; the dev server logs NF-041 as a warning and goes on.
 */
export function assertPatchedFlightClient(
  version: string,
  location: string,
  command: 'build' | 'serve'
): void {
  const patched = patchedFlightClientVersion(version)
  if (!patched) return
  const detail = `react-server-dom-webpack ${version} (${location}) is affected by ${RSC_ADVISORY}, unauthenticated remote code execution in React Server Components (${RSC_ADVISORY_URL}). Install ${patched} or later, with react and react-dom at the same exact version: npm install --save-exact react@${patched} react-dom@${patched} react-server-dom-webpack@${patched}.`
  if (command === 'serve') {
    logger.warn('NF-041', `${detail} A production build refuses it.`)
    return
  }
  throw new NFError('NF-041', detail)
}

// @vitejs/plugin-react's Babel and Fast Refresh plugins (6.x names), and
// @vitejs/plugin-react-swc (`vite:react-swc`, `vite:react-swc:resolve-runtime`).
const FAST_REFRESH_PLUGIN =
  /^vite:react(-refresh|-babel|:refresh|-virtual-preamble|-swc)/

/**
 * NF-002 if a Fast Refresh plugin is installed: its code expects a preamble
 * that only Vite-served pages have, so island modules loaded into a host would
 * fail.
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

/**
 * True when the module's own directive prologue holds `'use server'`: a file of
 * Server Actions. Code that does not parse returns false; the compiler reports it.
 */
export function hasFileLevelUseServer(
  code: string,
  filename = 'module.tsx'
): boolean {
  if (!code.includes('use server')) return false
  const { program, errors } = parseSync(filename, code)
  if (errors.length > 0) return false
  for (const statement of program.body as Node[]) {
    if (statement.type !== 'ExpressionStatement') break
    if (typeof statement.directive !== 'string') break
    if (statement.directive === 'use server') return true
  }
  return false
}

type JsxNode = {
  type?: unknown
  name?: { type?: unknown; name?: unknown }
  value?: { type?: unknown } | null
  attributes?: JsxNode[]
  openingElement?: JsxNode
  start?: number
}

type ImportNode = {
  type?: unknown
  source?: { value?: unknown }
  specifiers?: {
    type?: unknown
    imported?: { name?: unknown; value?: unknown }
    local?: { name?: unknown }
  }[]
}

const ISLAND_PACKAGE = '@next-federation/island'

const isExpressionValue = (attr: JsxNode): boolean =>
  attr.value?.type === 'JSXExpressionContainer'

/**
 * Every local name the island's `Form` is imported under. A `Form` defined in
 * the file or imported from anywhere else is an ordinary component.
 */
function formNames(body: unknown[]): Set<string> {
  const names = new Set<string>()
  for (const statement of body as ImportNode[]) {
    if (
      statement.type !== 'ImportDeclaration' ||
      statement.source?.value !== ISLAND_PACKAGE
    ) {
      continue
    }
    for (const spec of statement.specifiers ?? []) {
      const imported = spec.imported?.name ?? spec.imported?.value
      if (
        spec.type === 'ImportSpecifier' &&
        imported === 'Form' &&
        typeof spec.local?.name === 'string'
      ) {
        names.add(spec.local.name)
      }
    }
  }
  return names
}

/**
 * 1-based lines of `<form action={...}>` and of `formAction={...}` (a Server
 * Action on a plain form: NF-035). A `formAction` inside a `<Form>` element
 * (the island's `Form`, imported from `@next-federation/island` under any
 * local name) is safe: that form stays disabled until hydration. String values, `<Form>` itself, member names
 * (`<x.form>`) and spreads are not reported. Code that does not parse returns [].
 */
export function findRawFormActions(
  code: string,
  filename = 'module.tsx'
): number[] {
  if (!/action/i.test(code)) return []
  const { program, errors } = parseSync(filename, code)
  if (errors.length > 0) return []
  const safeForms = formNames(program.body as unknown[])
  const offsets: number[] = []
  // Each entry carries whether it sits inside a `<Form>` (nearest form wins).
  const stack: [unknown, boolean][] = [[program, false]]
  while (stack.length > 0) {
    const [value, inForm] = stack.pop()!
    if (Array.isArray(value)) {
      for (const item of value) stack.push([item, inForm])
      continue
    }
    if (value === null || typeof value !== 'object') continue
    const node = value as JsxNode
    let childInForm = inForm
    if (node.type === 'JSXElement') {
      const opening = node.openingElement
      const tag =
        opening?.name?.type === 'JSXIdentifier' ? opening.name.name : null
      if (typeof tag === 'string' && safeForms.has(tag)) childInForm = true
      else if (tag === 'form') childInForm = false
      // The opening element's own attributes belong to the enclosing form.
      if (opening) stack.push([opening, inForm])
      for (const [key, child] of Object.entries(value)) {
        if (key === 'openingElement') continue
        if (child !== null && typeof child === 'object') {
          stack.push([child, childInForm])
        }
      }
      continue
    }
    if (node.type === 'JSXOpeningElement') {
      const tag = node.name?.type === 'JSXIdentifier' ? node.name.name : null
      for (const attr of node.attributes ?? []) {
        if (attr.type !== 'JSXAttribute' || !isExpressionValue(attr)) continue
        const prop = attr.name?.type === 'JSXIdentifier' ? attr.name.name : null
        if (
          (tag === 'form' && prop === 'action') ||
          (!inForm &&
            typeof tag === 'string' &&
            /^[a-z]/.test(tag) &&
            prop === 'formAction')
        ) {
          offsets.push(attr.start ?? 0)
        }
      }
    }
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === 'object') {
        stack.push([child, childInForm])
      }
    }
  }
  const lineOf = (offset: number): number =>
    code.slice(0, offset).split('\n').length
  return [...new Set(offsets.map(lineOf))].sort((a, b) => a - b)
}
