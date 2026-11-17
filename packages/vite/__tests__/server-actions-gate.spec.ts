// Gate G2 (Phase 3): what next-federation's action route relies on from
// @vitejs/plugin-rsc 0.5.39, proved on a real production build of a minimal app
// (plugin-rsc alone, no next-federation plugin):
// - every export of a 'use server' file, including `export const x = requireIdentity(...)`,
//   is the same function object registered as a server reference: `$$typeof` and `$$id`
//   are set on it and the requireIdentity marker survives;
// - `loadServerAction($$id)` returns that object, and every `$$id` passes the protocol's
//   action id check;
// - a server reference passed straight to `<Form action>` (a 'use client' component)
//   server-renders through the SSR environment, and the decoded reference calls the
//   callServer of the flight client that decoded it.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isActionId } from '@next-federation/protocol'
// The gate is about plugin-rsc itself, so it uses it without next-federation's plugin.
// eslint-disable-next-line no-restricted-imports
import rsc from '@vitejs/plugin-rsc'
import { createBuilder } from 'vite'

const pkg = resolve(import.meta.dirname, '..')
const root = join(pkg, '.nf-g2-build')
const serverAction = resolve(pkg, '../server/src/action.ts')
const islandForm = resolve(pkg, '../island/src/form.tsx')

const files: Record<string, string> = {
  'actions.ts': `'use server'
import { requireIdentity } from ${JSON.stringify(serverAction)}
export async function add(a: number, b: number) { return a + b }
export const guarded = requireIdentity(async () => 'secret')
export const arrow = async () => 'arrow'
`,
  'entry.rsc.tsx': `import * as actions from './actions.ts'
import { loadServerAction, renderToReadableStream } from '@vitejs/plugin-rsc/rsc'
import { Form } from ${JSON.stringify(islandForm)}

const MARK = Symbol.for('next-federation.requires-identity')
export function inspect() {
  return Object.entries(actions).map(([name, fn]: [string, any]) => ({
    name,
    serverReference: fn.$$typeof === Symbol.for('react.server.reference'),
    id: fn.$$id,
    requiresIdentity: fn[MARK] === true,
  }))
}
export async function loadsSame() {
  const out: Record<string, boolean> = {}
  for (const [name, fn] of Object.entries(actions) as [string, any][]) {
    out[name] = (await loadServerAction(fn.$$id)) === fn
  }
  return out
}
export async function call(id: string, args: unknown[]) {
  const fn: any = await loadServerAction(id)
  return fn(...args)
}
type Ssr = typeof import('./entry.ssr.tsx')
const ssr = () => import.meta.viteRsc.loadModule<Ssr>('ssr', 'index')
export async function formHtml() {
  const stream = renderToReadableStream(
    <Form action={actions.add} id="f"><button>Add</button></Form>
  )
  return (await ssr()).html(stream)
}
export function referencePayload() {
  return new Response(renderToReadableStream({ action: actions.add })).text()
}
`,
  'entry.ssr.tsx': `import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr'
import { use } from 'react'
import type { ReactNode } from 'react'
import { renderToReadableStream } from 'react-dom/server.edge'

export async function html(rsc: ReadableStream<Uint8Array>) {
  const payload = createFromReadableStream<ReactNode>(rsc)
  function Root(): ReactNode { return use(payload) }
  const stream = await renderToReadableStream(<Root />)
  await stream.allReady
  return new Response(stream).text()
}
`,
  'entry.client.tsx': `export {}\n`,
}

type RscEntry = {
  inspect(): {
    name: string
    serverReference: boolean
    id: string
    requiresIdentity: boolean
  }[]
  loadsSame(): Promise<Record<string, boolean>>
  call(id: string, args: unknown[]): Promise<unknown>
  formHtml(): Promise<string>
  referencePayload(): Promise<string>
}

let entry: RscEntry
const savedNodeEnv = process.env.NODE_ENV

beforeAll(async () => {
  process.env.NODE_ENV = 'production'
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  for (const [name, code] of Object.entries(files)) {
    await writeFile(join(root, name), code)
  }
  const builder = await createBuilder({
    root,
    configFile: false,
    logLevel: 'error',
    oxc: {
      jsx: { runtime: 'automatic', importSource: 'react', refresh: false },
    },
    plugins: [
      rsc({
        entries: {
          rsc: './entry.rsc.tsx',
          ssr: './entry.ssr.tsx',
          client: './entry.client.tsx',
        },
        serverHandler: false,
        rscCssTransform: false,
      }),
    ],
  })
  await builder.buildApp()
  entry = (await import(
    pathToFileURL(join(root, 'dist/rsc/index.js')).href
  )) as RscEntry
}, 180000)

afterAll(async () => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = savedNodeEnv
  await rm(root, { recursive: true, force: true })
})

test('every export is a server reference with its own $$id, and requireIdentity survives', () => {
  const found = entry.inspect()
  expect(found.map((f) => f.name).sort()).toEqual(['add', 'arrow', 'guarded'])
  for (const f of found) {
    expect(f.serverReference).toBe(true)
    expect(f.id.endsWith(`#${f.name}`)).toBe(true)
    expect(isActionId(f.id)).toBe(true)
  }
  const byName = Object.fromEntries(found.map((f) => [f.name, f]))
  expect(byName.guarded!.requiresIdentity).toBe(true)
  expect(byName.add!.requiresIdentity).toBe(false)
  // One file, one id prefix.
  expect(new Set(found.map((f) => f.id.split('#')[0])).size).toBe(1)
})

test('loadServerAction($$id) returns the very exported object', async () => {
  expect(await entry.loadsSame()).toEqual({
    add: true,
    arrow: true,
    guarded: true,
  })
  const id = entry.inspect().find((f) => f.name === 'add')!.id
  expect(await entry.call(id, [2, 3])).toBe(5)
})

test('a server reference passed straight to <Form action> server-renders, disabled', async () => {
  const html = await entry.formHtml()
  expect(html).toContain('<form')
  expect(html).toMatch(/<fieldset[^>]*disabled/)
  expect(html).toContain('<button>Add</button>')
  // React's progressive-enhancement markup: before hydration the form would post
  // to the page itself. <Form>'s disabled fieldset is what prevents that (gate G1).
  expect(html).toMatch(/<form[^>]*action=""[^>]*method="POST"/)
  expect(html).toMatch(/name="\$ACTION_ID_[^"]+#add"/)
})

test("a decoded server reference calls its flight client's callServer", async () => {
  const seen: { id: string; args: unknown[] }[] = []
  const text = await entry.referencePayload()
  // The flight client the island bootstrap uses (bootstrap.client.tsx). Its webpack
  // globals only matter for client references, which this payload has none of.
  const g = globalThis as Record<string, unknown>
  g.__webpack_require__ ??= () => {
    throw new Error('no client references expected')
  }
  g.__webpack_chunk_load__ ??= () => Promise.resolve()
  const { createFromReadableStream } = (await import(
    // @ts-expect-error untyped package (typed for the build in src/plugin-rsc/env.d.ts)
    'react-server-dom-webpack/client.browser'
  )) as {
    createFromReadableStream(
      stream: ReadableStream<Uint8Array>,
      options: { callServer: (id: string, args: unknown[]) => Promise<unknown> }
    ): Promise<unknown>
  }
  const decoded = (await createFromReadableStream(new Response(text).body!, {
    callServer: async (id: string, args: unknown[]) => {
      seen.push({ id, args })
      return 'from-callServer'
    },
  })) as { action: (...a: unknown[]) => Promise<unknown> }
  expect(await decoded.action(2, 3)).toBe('from-callServer')
  const addId = entry.inspect().find((f) => f.name === 'add')!.id
  expect(seen).toEqual([{ id: addId, args: [2, 3] }])
})
