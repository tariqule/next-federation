/**
 * The page-global require that `@vitejs/plugin-rsc` 0.5.39 patches into the
 * browser flight client (its `rsc:patch-react-server-dom-webpack` transform
 * rewrites `__webpack_require__` to this name). Kept here because it is
 * plugin-rsc knowledge; `scopeFlightClient` rewrites it to this build's slot.
 */
export const PLUGIN_RSC_REQUIRE_GLOBAL = '__vite_rsc_require__'

/** The only `@vitejs/plugin-rsc` version this package is tested against. */
export const SUPPORTED_PLUGIN_RSC_VERSION = '0.5.39'

/** The export appended to every island module in the `rsc` environment. */
export const ISLAND_CSS_EXPORT = '__nf_css'
