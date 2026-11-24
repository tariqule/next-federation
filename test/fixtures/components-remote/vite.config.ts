// The components remote (client components) fixture, built by
// @next-federation/vite's nextFederationComponents and served by nf-serve.
// Env (set by test/e2e/servers.ts and mode-a.spec.ts):
//   PORT                       listen port, baked into `base` at build time
//   NF_OUT                     output folder (default dist/components)
//   NF_BUILD_ID                the build id (default: the build time)
//   NF_COMPONENTS_SIGNING_KEY  private JWK: sign the descriptor (read by the plugin)
//   NF_BALLAST                 n: ~8n bytes of module data (memory checks)
//   NF_LINKS                   '1': the links build (router.spec.ts): only the
//                              Router* exposes, written with next/link,
//                              next/navigation and react-router, which the
//                              plugin rewires. The other builds list next/link
//                              and next/navigation in `shared` (host-provided,
//                              for NavLink), and the plugin never rewires a
//                              listed specifier, so one build cannot do both.
//   NF_ROUTER_RANGE            the range of the router this links build
//                              accepts (the range-miss build: '>=9.0.0');
//                              default: the plugin's own
//   NF_REACT_RANGE             the React versions the build accepts (the
//                              React 18 hosts' build: '^18.3.0 || ^19.0.0');
//                              default: the plugin's own ('^19.0.0')
import { nextFederationComponents } from '@next-federation/vite'
import { defineConfig } from 'vite'
import { lanePort } from '../../e2e/lane.ts'

const PORT = Number(process.env.PORT ?? lanePort(4110))
const LINKS = process.env.NF_LINKS === '1'
const ROUTER_RANGE = process.env.NF_ROUTER_RANGE
const REACT_RANGE = process.env.NF_REACT_RANGE || undefined

// Every other build: modules shared with the host.
const nextModules = {
  // The host owns this context: the remote reads the host's value.
  'components-context': {},
  // Bundled too: used when the host's copy is missing or not ^2.
  'components-fallback-lib': {
    requiredVersion: '^2.0.0',
    fallback: true,
  },
  // A Next.js host's own router modules (NavLink, PagesNavLink).
  'next/link': {},
  'next/navigation': {},
  'next/router': {},
}
// The links build: nothing listed but the range-miss build's router range,
// so next/link, next/navigation and react-router are rewired.
const links: Record<string, { requiredVersion: string; fallback: boolean }> =
  ROUTER_RANGE
    ? {
        '@next-federation/router': {
          requiredVersion: ROUTER_RANGE,
          fallback: true,
        },
      }
    : {}

export default defineConfig({
  define: {
    __NF_FIXTURE_BUILD__: JSON.stringify(process.env.NF_BUILD_ID ?? 'dev'),
    __NF_BALLAST__: String(Number(process.env.NF_BALLAST ?? 0)),
  },
  plugins: [
    nextFederationComponents({
      name: 'components',
      base: `http://127.0.0.1:${PORT}/`,
      exposes: LINKS
        ? {
            // The remote's own router, rewired: works in any host
            // (router.spec.ts).
            './RouterLink': './src/RouterLink.tsx',
            './RouterSearch': './src/RouterSearch.tsx',
            './RouterReactRouter': './src/RouterReactRouter.tsx',
            './RouterInternal': './src/RouterInternal.tsx',
          }
        : {
            './Counter': './src/Counter.tsx',
            './NavLink': './src/NavLink.tsx',
            './PagesNavLink': './src/PagesNavLink.tsx',
            './Versioned': './src/Versioned.tsx',
            // Throws while rendering (render-error handling).
            './Boom': './src/Boom.tsx',
          },
      shared: LINKS ? links : nextModules,
      react: REACT_RANGE,
      // Publish the exposed modules' declarations (hosts' nf-types).
      types: true,
      outDir: process.env.NF_OUT ?? 'dist/components',
    }),
  ],
})
