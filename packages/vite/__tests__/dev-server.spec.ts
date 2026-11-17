// The checks plugin inside a real Vite dev server (serve mode), where module
// info differs from a build: a 'use server' file requested in the client
// environment must fail with NF-034 straight away.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isNFError } from '@next-federation/sdk'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { nextFederationIslands } from '../src/index.ts'

const root = resolve(import.meta.dirname, '../.nf-dev-server-spec')
let server: ViteDevServer

beforeAll(async () => {
  await rm(root, { recursive: true, force: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src/actions.ts'),
    "'use server'\nexport async function save() { return 1 }\n"
  )
  await writeFile(
    join(root, 'src/Button.tsx'),
    "'use client'\nimport { save } from './actions'\nexport function Button() { return <button onClick={() => save()}>x</button> }\n"
  )
  await writeFile(
    join(root, 'src/Panel.tsx'),
    'export default function Panel() { return <p>x</p> }\n'
  )
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [
      ...nextFederationIslands({
        name: 'devspec',
        base: 'http://127.0.0.1:4199/',
        hosts: ['http://localhost:3100'],
        islands: { Panel: './src/Panel.tsx' },
      }),
    ],
  })
}, 60000)

afterAll(async () => {
  await server?.close()
  await rm(root, { recursive: true, force: true })
})

async function errorOf(url: string, env: 'client' | 'ssr'): Promise<unknown> {
  try {
    await server.environments[env]!.transformRequest(url)
  } catch (error) {
    return error
  }
  return null
}

test.each(['client', 'ssr'] as const)(
  "a 'use server' file requested in the %s environment is NF-034",
  async (env) => {
    const error = await errorOf('/src/actions.ts', env)
    const nf = (error as { cause?: unknown })?.cause ?? error
    expect(isNFError(nf, 'NF-034') || String(error).includes('NF-034')).toBe(
      true
    )
    expect(String((error as Error).message)).toContain('actions.ts')
  }
)

test('a client module that imports it, transformed first, is named as the importer', async () => {
  await server.environments.client!.transformRequest('/src/Button.tsx')
  const error = await errorOf('/src/actions.ts?t=2', 'client')
  expect(String((error as Error).message)).toContain('NF-034')
  expect(String((error as Error).message)).toContain('Button.tsx')
})
