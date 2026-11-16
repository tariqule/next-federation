import type { Plugin } from 'vite'
import { FLIGHT_CLIENT_ID, scopeFlightClient } from '../scope-flight-client.ts'

/**
 * Build pipeline: scopes the flight client in plugin-rsc's `client`
 * environment. `scopeKey` may be a getter, because the key depends on the Vite
 * command and is only known once the config hook has run. `post`, so it runs after plugin-rsc has patched
 * `__webpack_require__` to its own page global.
 */
export function flightScopePlugin(scopeKey: string | (() => string)): Plugin {
  const key = typeof scopeKey === 'string' ? () => scopeKey : scopeKey
  return {
    name: 'nf:scope-flight-client',
    enforce: 'post',
    applyToEnvironment: (environment) => environment.name === 'client',
    transform: {
      filter: { id: FLIGHT_CLIENT_ID },
      handler: (code) => ({
        code: scopeFlightClient(code, key()),
        map: null,
      }),
    },
  }
}

/**
 * Dev: the flight client is pre-bundled by the dependency optimizer, outside
 * the plugin pipeline, so it needs its own (rolldown) plugin.
 */
export function flightScopeOptimizerPlugin(scopeKey: string): Plugin {
  return {
    name: 'nf:scope-flight-client-optimizer',
    transform: {
      filter: { id: FLIGHT_CLIENT_ID },
      handler: (code: string) => ({
        code: scopeFlightClient(code, scopeKey),
        map: null,
      }),
    },
  }
}
