import { isNFError } from '@next-federation/sdk'
import {
  assertNoFastRefresh,
  assertPluginRscVersion,
  findRawFormActions,
  findServerActions,
  hasFileLevelUseServer,
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

test.each([
  ["'use server'\nexport async function a() {}", true],
  ['"use server";\nexport const a = async () => 1', true],
  ["'use strict'\n'use server'\nexport async function a() {}", true],
  ["export async function a() {\n  'use server'\n}", false],
  ["const x = 1\n'use server'", false],
  ["// 'use server'\nexport {}", false],
  ["'use client'\nexport {}", false],
  ["'use server'\nexport const = ", false],
])('hasFileLevelUseServer(%p) is %p', (code, expected) => {
  expect(hasFileLevelUseServer(code, 'a.ts')).toBe(expected)
})

test('findRawFormActions finds <form action={...}> and formAction={...}, with line numbers', () => {
  const code = [
    'export function A({ save }) {',
    '  return (',
    '    <form action={save}>',
    '      <button formAction={save}>x</button>',
    '      <input formAction={save} />',
    '    </form>',
    '  )',
    '}',
  ].join('\n')
  expect(findRawFormActions(code, 'A.tsx')).toEqual([3, 4, 5])
})

test('findRawFormActions ignores string actions, other elements, <Form> and spreads', () => {
  const code = [
    'import { Form } from "@next-federation/island"',
    'export function A({ save, rest }) {',
    '  return (<>',
    '    <form action="/search" />',
    '    <Form action={save} />',
    '    <div action={save} />',
    '    <form {...rest} />',
    '    <x.form action={save} />',
    '  </>)',
    '}',
  ].join('\n')
  expect(findRawFormActions(code, 'A.tsx')).toEqual([])
  expect(findRawFormActions('export const a = 1', 'a.ts')).toEqual([])
  expect(findRawFormActions('<form action={', 'bad.tsx')).toEqual([])
})

test('findRawFormActions: formAction inside <Form> is safe, inside <form> it is not', () => {
  const code = [
    'import { Form, Form as IslandForm } from "@next-federation/island"',
    'export function A({ save, items }) {',
    '  return (<>',
    '    <Form action={save}>',
    '      <button formAction={save}>x</button>',
    '      {items.map((i) => <input key={i} formAction={save} />)}',
    '      <div><button formAction={save}>nested</button></div>',
    '    </Form>',
    '    <IslandForm><button formAction={save}>alias</button></IslandForm>',
    '    <form action={save}>',
    '      <button formAction={save}>raw</button>',
    '    </form>',
    '    <button formAction={save}>outside</button>',
    '    <Form><form><button formAction={save}>inner raw</button></form></Form>',
    '  </>)',
    '}',
  ].join('\n')
  expect(findRawFormActions(code, 'A.tsx')).toEqual([10, 11, 13, 14])
})

test('findRawFormActions: a Form that is not the island Form is not safe', () => {
  const local = [
    'function Form({ children }) { return <form>{children}</form> }',
    'export function A({ save }) {',
    '  return <Form><button formAction={save}>local</button></Form>',
    '}',
  ].join('\n')
  expect(findRawFormActions(local, 'A.tsx')).toEqual([3])
  const other = [
    'import { Form } from "./form"',
    'import { Form as IslandForm } from "@next-federation/island"',
    'export function A({ save }) {',
    '  return (<>',
    '    <Form><button formAction={save}>other</button></Form>',
    '    <IslandForm><button formAction={save}>island</button></IslandForm>',
    '  </>)',
    '}',
  ].join('\n')
  expect(findRawFormActions(other, 'A.tsx')).toEqual([5])
})
