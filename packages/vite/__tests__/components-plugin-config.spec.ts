// The Vite config the components remote plugin adds in dev.
import type { Plugin, UserConfig } from 'vite'
import { nextFederationComponents } from '../src/components/plugin.ts'

const ENV_KEYS = ['NF_VITE_COMMAND', 'MFE_VITE_NO_TEST_ENV_CHECK']
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.NF_VITE_COMMAND = 'serve'
  process.env.MFE_VITE_NO_TEST_ENV_CHECK = 'true'
})

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function devConfig(user: UserConfig): UserConfig {
  const plugins = nextFederationComponents({
    name: 'shop',
    base: 'http://localhost:4110/',
    exposes: { './Counter': './src/Counter.tsx' },
  }) as Plugin[]
  const nf = plugins.find((p) => p.name === 'nf:components')!
  const config = nf.config as (
    user: UserConfig,
    env: { command: 'serve'; mode: string }
  ) => UserConfig
  return config(user, { command: 'serve', mode: 'development' })
}

test("dev: the host's browser console is not forwarded to the remote's terminal, unless the remote asks for it", () => {
  expect(devConfig({}).server?.forwardConsole).toBe(false)
  expect(
    devConfig({ server: { forwardConsole: true } }).server?.forwardConsole
  ).toBeUndefined()
})

describe('dev: a page of the project served by the remote (B3)', () => {
  type Req = { url: string; method: string; headers: Record<string, string> }
  type Middleware = (req: Req, res: unknown, next: () => void) => void
  function devMiddlewares(): Middleware[] {
    const plugins = nextFederationComponents({
      name: 'shop',
      base: 'http://localhost:4110/',
      exposes: { './Counter': './src/Counter.tsx' },
    }) as Plugin[]
    const nf = plugins.find((p) => p.name === 'nf:components')!
    const used: Middleware[] = []
    ;(nf.configureServer as (server: unknown) => void)({
      middlewares: { use: (fn: Middleware) => used.push(fn) },
    })
    return used
  }
  const request = (url: string, accept: string): Req => ({
    url,
    method: 'GET',
    headers: { accept },
  })
  const run = (mws: Middleware[], req: Req) => {
    let passed = 0
    for (const mw of mws) mw(req, {}, () => passed++)
    return passed
  }

  test('warns NF-002 once, pointing to the two-config setup, and still serves the page', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const mws = devMiddlewares()
      const html = 'text/html,application/xhtml+xml,*/*;q=0.8'
      expect(run(mws, request('/', html))).toBe(mws.length)
      run(mws, request('/index.html', html))
      const nf002 = warn.mock.calls
        .map((args: unknown[]) => args.join(' '))
        .filter((line: string) => line.includes('NF-002'))
      expect(nf002).toHaveLength(1)
      expect(nf002[0]).toContain('host-provided')
      expect(nf002[0]).toContain(
        'remote-components.md#keeping-a-standalone-app'
      )
    } finally {
      warn.mockRestore()
    }
  })

  test('module, manifest and descriptor requests (what a host loads) never warn', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const mws = devMiddlewares()
      run(mws, request('/remoteEntry.js', '*/*'))
      run(mws, request('/mf-manifest.json', 'application/json'))
      run(mws, request('/src/Counter.tsx', '*/*'))
      expect(
        warn.mock.calls.filter((args: unknown[]) =>
          args.join(' ').includes('NF-002')
        )
      ).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})
