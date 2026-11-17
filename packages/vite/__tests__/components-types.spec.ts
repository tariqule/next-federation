// Type declarations of a components remote's exposed modules: emitted with
// the TypeScript compiler API into `client/@mf-types/` (Module Federation's
// layout), never executed by hosts.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as ts from 'typescript'
import { isNFError } from '@next-federation/sdk'
import {
  emitBuildTypes,
  emitExposeTypes,
  loadTypeScript,
} from '../src/components/types.ts'
import { resolveComponentsOptions } from '../src/components/options.ts'

let root: string
let client: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nf-vite-types-'))
  client = join(root, 'dist', 'b1', 'client')
  await mkdir(join(root, 'src', 'ui'), { recursive: true })
  await mkdir(client, { recursive: true })
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'preserve',
        moduleResolution: 'bundler',
        target: 'ES2022',
        jsx: 'react-jsx',
        noEmit: true,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        types: [],
      },
      include: ['src'],
    })
  )
  await writeFile(
    join(root, 'src', 'format.ts'),
    'export type Format = "short" | "long"\n'
  )
  await writeFile(
    join(root, 'src', 'Counter.tsx'),
    [
      "import type { Format } from './format.ts'",
      "import './Counter.css'",
      'declare const __BUILD__: string',
      'export default function Counter(props: { start?: number; format?: Format }) {',
      '  return <span>{__BUILD__}{props.start}</span>',
      '}',
      '',
    ].join('\n')
  )
  await writeFile(join(root, 'src', 'Counter.css'), '.x{}')
  await writeFile(
    join(root, 'src', 'ui', 'Button.tsx'),
    'export function Button(props: { label: string }) {\n  return <button>{props.label}</button>\n}\n'
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const read = (path: string) => readFile(join(client, path), 'utf8')

test("emits each expose's declarations and an entry file per expose", async () => {
  await emitExposeTypes(ts, {
    root,
    exposes: {
      './Counter': './src/Counter.tsx',
      './ui/Button': './src/ui/Button.tsx',
    },
    clientDir: client,
  })
  const counter = await read('@mf-types/compiled-types/src/Counter.d.ts')
  expect(counter).toMatch(/start\?: number/)
  expect(counter).toMatch(/format\?: Format/)
  // Its local imports are emitted too; the stylesheet import is not.
  expect(
    existsSync(join(client, '@mf-types/compiled-types/src/format.d.ts'))
  ).toBe(true)
  expect(counter).not.toMatch(/Counter\.css/)
  expect(await read('@mf-types/Counter.d.ts')).toBe(
    'export * from "./compiled-types/src/Counter.js"\nexport { default } from "./compiled-types/src/Counter.js"\n'
  )
  // No default export: only the named exports.
  expect(await read('@mf-types/ui/Button.d.ts')).toBe(
    'export * from "../compiled-types/src/ui/Button.js"\n'
  )
  // Nothing but declarations.
  expect(
    existsSync(join(client, '@mf-types/compiled-types/src/Counter.js'))
  ).toBe(false)
})

test('a declaration emit failure is NF-002 (the build would publish wrong types)', async () => {
  await writeFile(
    join(root, 'src', 'Counter.tsx'),
    'export default function Counter( {\n'
  )
  const error = await emitExposeTypes(ts, {
    root,
    exposes: { './Counter': './src/Counter.tsx' },
    clientDir: client,
  }).catch((e: unknown) => e)
  expect(isNFError(error) && error.code).toBe('NF-002')
  expect(String((error as Error).message)).toMatch(/Counter\.tsx/)
})

test('loadTypeScript resolves the remote project’s own typescript, or null', () => {
  expect(loadTypeScript(root)).toBeNull()
  const repoRoot = resolve(import.meta.dirname, '../../..')
  expect(typeof loadTypeScript(repoRoot)?.createProgram).toBe('function')
})

test('the `types` option: off by default (0.x), `true` opts in', () => {
  const ctx = { command: 'build' as const, env: {}, now: 1_700_000_000_000 }
  const options = {
    name: 'components',
    base: 'https://remote.example',
    exposes: { './Counter': './src/Counter.tsx' },
  }
  expect(resolveComponentsOptions(options, ctx).types).toBe(false)
  expect(resolveComponentsOptions({ ...options, types: true }, ctx).types).toBe(
    true
  )
  let code: unknown
  try {
    resolveComponentsOptions({ ...options, types: 'yes' as never }, ctx)
  } catch (error) {
    code = isNFError(error) && error.code
  }
  expect(code).toBe('NF-002')
})

test('comments are never published; package imports stay bare', async () => {
  // A non-exposed module the expose imports: its declarations become
  // public, its comments (and so any note in them) do not.
  await writeFile(
    join(root, 'src', 'config.ts'),
    "/** Internal: rotate before launch, see the ops vault. */\nexport type Mode = 'a' | 'b'\n"
  )
  await mkdir(join(root, 'node_modules', 'inner'), { recursive: true })
  await writeFile(
    join(root, 'node_modules', 'inner', 'package.json'),
    JSON.stringify({ name: 'inner', types: 'index.ts', main: 'index.ts' })
  )
  await writeFile(
    join(root, 'node_modules', 'inner', 'index.ts'),
    'export type Inner = { y: number }\n'
  )
  await writeFile(
    join(root, 'src', 'Counter.tsx'),
    [
      "import type { Mode } from './config.ts'",
      "import type { Inner } from 'inner'",
      '/** The counter. */',
      'export default function Counter(props: { mode?: Mode; i?: Inner }) {',
      '  // a private note',
      '  return <span>{props.mode}</span>',
      '}',
      '',
    ].join('\n')
  )
  await emitExposeTypes(ts, {
    root,
    exposes: { './Counter': './src/Counter.tsx' },
    clientDir: client,
  })
  const config = await read('@mf-types/compiled-types/src/config.d.ts')
  expect(config).toMatch(/Mode/)
  expect(config).not.toMatch(/ops vault|Internal/)
  const counter = await read('@mf-types/compiled-types/src/Counter.d.ts')
  expect(counter).not.toMatch(/The counter|private note/)
  expect(counter).toMatch(/from 'inner'/)
  const { readdir } = await import('node:fs/promises')
  const all = await readdir(join(client, '@mf-types'), { recursive: true })
  expect(all.filter((f) => f.endsWith('.d.ts')).sort()).toEqual([
    'Counter.d.ts',
    'compiled-types/src/Counter.d.ts',
    'compiled-types/src/config.d.ts',
  ])
})

test('pinned /*! comments are stripped too; string literals are left alone', async () => {
  // A detached `/*!` header survives TypeScript's removeComments.
  await writeFile(
    join(root, 'src', 'config.ts'),
    [
      '/*! internal: rotate key in /Users/alice/vault */',
      '',
      "export type Mode = 'a' | 'b' /*! trailing */",
      "export const NOTE = '/*! kept: a string */ // also kept'",
      'export interface Opts {',
      '  /*! inside */ mode?: Mode // trail',
      '}',
      '',
    ].join('\n')
  )
  await writeFile(
    join(root, 'src', 'Counter.tsx'),
    [
      "import { NOTE, type Opts } from './config.ts'",
      'export default function Counter(props: Opts) {',
      '  return <span>{NOTE}{props.mode}</span>',
      '}',
      '',
    ].join('\n')
  )
  await emitExposeTypes(ts, {
    root,
    exposes: { './Counter': './src/Counter.tsx' },
    clientDir: client,
  })
  const config = await read('@mf-types/compiled-types/src/config.d.ts')
  expect(config).not.toMatch(/vault|trailing|inside|trail\b/)
  expect(config).toContain('"/*! kept: a string */ // also kept"')
  expect(config).toMatch(/mode\?: Mode;/)
})

test('literal values are published as written: consts, as const, enums, typeof consts, values from outside the root', async () => {
  const outside = join(root, '..', `${root.split('/').pop()}-lit`)
  await mkdir(outside, { recursive: true })
  await writeFile(
    join(outside, 'urls.ts'),
    "export const BILLING = 'https://billing.internal.corp'\n"
  )
  await writeFile(
    join(root, 'src', 'Counter.tsx'),
    [
      `import { BILLING } from '../../${outside.split('/').pop()}/urls.ts'`,
      "const hidden = 'hidden-value'",
      "export const KEY = 'sk_live_secret'",
      "export const obj = { a: 'as-const-value' } as const",
      "export enum Plan { Pro = 'enum-value' }",
      'export const h: typeof hidden = hidden',
      'export const url = BILLING',
      'export default function Counter() {',
      '  return <span />',
      '}',
      '',
    ].join('\n')
  )
  try {
    await emitExposeTypes(ts, {
      root,
      exposes: { './Counter': './src/Counter.tsx' },
      clientDir: client,
      warn: () => {},
    })
    const counter = await read('@mf-types/compiled-types/src/Counter.d.ts')
    // What the guide warns about: none of these is hidden by `types`.
    expect(counter).toContain('export declare const KEY = "sk_live_secret";')
    expect(counter).toContain('readonly a: "as-const-value";')
    expect(counter).toContain('Pro = "enum-value"')
    expect(counter).toContain('declare const hidden = "hidden-value";')
    expect(counter).toContain(
      'export declare const url = "https://billing.internal.corp";'
    )
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})

describe('a declaration that points outside the remote root publishes no types', () => {
  let outside: string
  let outsideName: string
  beforeEach(async () => {
    outsideName = `${root.split('/').pop()}-shared`
    outside = join(root, '..', outsideName)
    await mkdir(outside, { recursive: true })
    await writeFile(
      join(outside, 'util.ts'),
      'export type Shared = { x: number }\nexport function make(): Shared {\n  return { x: 1 }\n}\n'
    )
    await writeFile(
      join(outside, 'glob.d.ts'),
      'interface GlobalThing { z: number }\n'
    )
  })
  afterEach(async () => {
    await rm(outside, { recursive: true, force: true })
  })

  test.each([
    [
      'an absolute import',
      () => [
        `import type { Shared } from '${outside}/util.ts'`,
        'export default function Counter(props: { s?: Shared }) {',
        '  return <span>{props.s?.x}</span>',
        '}',
      ],
      () => `${outside}/util.ts`,
    ],
    [
      'a relative import above the root',
      () => [
        `import type { Shared } from '../../${outsideName}/util.ts'`,
        'export default function Counter(props: { s?: Shared }) {',
        '  return <span>{props.s?.x}</span>',
        '}',
      ],
      () => `../../${outsideName}/util.ts`,
    ],
    [
      'an inferred import() type above the root',
      () => [
        `import { make } from '../../${outsideName}/util.ts'`,
        'export const create = () => make()',
        'export default function Counter() {',
        '  return <span />',
        '}',
      ],
      () => `../../${outsideName}/util`,
    ],
    [
      'an ambient module declaration above the root',
      () => [
        `declare module '../../${outsideName}/util' {`,
        '  interface Extra { y: number }',
        '}',
        'export default function Counter() {',
        '  return <span />',
        '}',
      ],
      () => `../../${outsideName}/util`,
    ],
    [
      'a preserved reference path above the root',
      () => [
        `/// <reference path="../../${outsideName}/glob.d.ts" preserve="true" />`,
        'export const g: GlobalThing = { z: 1 }',
        'export default function Counter() {',
        '  return <span />',
        '}',
      ],
      () => `../../${outsideName}/glob.d.ts`,
    ],
    [
      'a preserved reference types above the root',
      () => [
        `/// <reference types="../../${outsideName}/glob" preserve="true" />`,
        'export const g: GlobalThing = { z: 1 }',
        'export default function Counter() {',
        '  return <span />',
        '}',
      ],
      () => `../../${outsideName}/glob`,
    ],
  ])('%s', async (_name, source, specifier) => {
    await writeFile(
      join(root, 'src', 'Counter.tsx'),
      [...source(), ''].join('\n')
    )
    const warnings: string[] = []
    const ok = await emitBuildTypes({
      types: true,
      ts,
      root,
      exposes: { './Counter': './src/Counter.tsx' },
      clientDir: client,
      warn: (line) => warnings.push(line),
    })
    expect(ok).toBe(false)
    expect(existsSync(join(client, '@mf-types'))).toBe(false)
    const text = warnings.join('\n')
    expect(text).toContain('compiled-types/src/Counter.d.ts')
    expect(text).toContain(specifier())
    expect(text).toMatch(/publishes no types/)
  })
})

test('emitBuildTypes: a declaration failure warns and publishes no types; no typescript warns too', async () => {
  await writeFile(
    join(root, 'src', 'Counter.tsx'),
    'export default function Counter( {\n'
  )
  const warnings: string[] = []
  const ok = await emitBuildTypes({
    types: true,
    ts,
    root,
    exposes: { './Counter': './src/Counter.tsx' },
    clientDir: client,
    warn: (line) => warnings.push(line),
  })
  expect(ok).toBe(false)
  expect(existsSync(join(client, '@mf-types'))).toBe(false)
  expect(warnings.join('\n')).toMatch(/Counter\.tsx/)
  expect(
    await emitBuildTypes({
      types: true,
      ts: null,
      root,
      exposes: { './Counter': './src/Counter.tsx' },
      clientDir: client,
      warn: (line) => warnings.push(line),
    })
  ).toBe(false)
  expect(warnings.at(-1)).toMatch(/typescript/)
  expect(
    await emitBuildTypes({
      types: false,
      ts,
      root,
      exposes: { './Counter': './src/Counter.tsx' },
      clientDir: client,
      warn: (line) => warnings.push(line),
    })
  ).toBe(false)
})
