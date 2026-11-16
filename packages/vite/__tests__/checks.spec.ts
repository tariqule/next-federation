import { isNFError } from '@next-federation/sdk'
import {
  assertNoFastRefresh,
  assertPluginRscVersion,
  findServerActions,
  hasUseClientDirective,
} from '../src/checks.ts'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return isNFError(error) ? error.code : `not an NFError: ${String(error)}`
  }
  return undefined
}

afterEach(() => {
  rs.restoreAllMocks()
})

test('plugin-rsc 0.5.39 passes', () => {
  expect(codeOf(() => assertPluginRscVersion('0.5.39', {}))).toBeUndefined()
})

test('plugin-rsc 0.5.40 is NF-025; with NF_ALLOW_PLUGIN_RSC=1 it only warns', () => {
  expect(codeOf(() => assertPluginRscVersion('0.5.40', {}))).toBe('NF-025')
  expect(codeOf(() => assertPluginRscVersion('0.5.38', {}))).toBe('NF-025')
  expect(
    codeOf(() =>
      assertPluginRscVersion('0.5.40', { NF_ALLOW_PLUGIN_RSC: 'true' })
    )
  ).toBe('NF-025')

  const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
  expect(
    codeOf(() => assertPluginRscVersion('0.5.40', { NF_ALLOW_PLUGIN_RSC: '1' }))
  ).toBeUndefined()
  expect(warn).toHaveBeenCalledTimes(1)
  expect(String(warn.mock.calls[0]?.join(' '))).toMatch(/NF-025.*0\.5\.40/)
})

test('the NF-025 message names the installed and the supported version', () => {
  try {
    assertPluginRscVersion('1.0.0', {})
  } catch (error) {
    expect(String((error as Error).message)).toMatch(/1\.0\.0/)
    expect(String((error as Error).message)).toMatch(/0\.5\.39/)
    return
  }
  throw new Error('expected NF-025')
})

test.each([
  `'use server'\nexport async function a(){}`,
  `export async function a(){ "use server" }`,
  `// header\n/* block */\n"use strict";\n'use server';\nexport const a = 1`,
  `export const a = async () => { 'use server'; return 1 }`,
  `export default { async m() { "use server" } }`,
  `const f = function () { 'use server' }`,
  `export async function a(x: number): Promise<number> { 'use server'; return x }`,
])('detects server actions: %s', (code) => {
  expect(findServerActions(code)).toBe(true)
})

test('a string literal "use server" inside an expression is not a directive', () => {
  expect(findServerActions(`const x = 'use server'`)).toBe(false)
  expect(findServerActions(`foo("use server")`)).toBe(false)
  expect(findServerActions(`export const a = 1\n'use server'`)).toBe(false)
  expect(findServerActions(`function a() { const s = 1; 'use server' }`)).toBe(
    false
  )
  expect(findServerActions('const t = `{ "use server" }`')).toBe(false)
  expect(findServerActions(`// 'use server'\nexport const a = 1`)).toBe(false)
  expect(findServerActions(`'use client'\nexport const a = 1`)).toBe(false)
  expect(findServerActions(`if (x) { 'use server' }`)).toBe(false)
})

test('JSX sources parse', () => {
  expect(
    findServerActions(
      `'use server'\nexport async function A() { return <p /> }`,
      'a.tsx'
    )
  ).toBe(true)
  expect(
    findServerActions(
      `export function A() { return <p>use server</p> }`,
      'a.jsx'
    )
  ).toBe(false)
})

test('Fast Refresh plugins are NF-002', () => {
  expect(
    codeOf(() => assertNoFastRefresh(['vite:rsc', 'vite:oxc']))
  ).toBeUndefined()
  expect(codeOf(() => assertNoFastRefresh(['vite:react-refresh']))).toBe(
    'NF-002'
  )
  expect(codeOf(() => assertNoFastRefresh(['vite:react-babel']))).toBe('NF-002')
  // @vitejs/plugin-react-swc
  expect(codeOf(() => assertNoFastRefresh(['vite:react-swc']))).toBe('NF-002')
  expect(
    codeOf(() => assertNoFastRefresh(['vite:react-swc:resolve-runtime']))
  ).toBe('NF-002')
})

test('hasUseClientDirective: only the module prologue counts', () => {
  expect(hasUseClientDirective(`'use client'\nexport const a = 1`)).toBe(true)
  expect(
    hasUseClientDirective(`'use strict'\n"use client"\nexport const a = 1`)
  ).toBe(true)
  expect(hasUseClientDirective(`export const a = 'use client'`)).toBe(false)
  expect(
    hasUseClientDirective(`import x from 'y'\n'use client'\nexport { x }`)
  ).toBe(false)
  expect(
    hasUseClientDirective(`export function f() { 'use client'; return 1 }`)
  ).toBe(false)
  expect(hasUseClientDirective(`// 'use client'\nexport {}`)).toBe(false)
})
