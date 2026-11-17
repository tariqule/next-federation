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
