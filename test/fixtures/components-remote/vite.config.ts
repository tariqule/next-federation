// The components remote (client components) fixture, built by
// @next-federation/vite's nextFederationComponents and served by nf-serve.
// Env (set by test/e2e/servers.ts and mode-a.spec.ts):
//   PORT                       listen port, baked into `base` at build time
//   NF_OUT                     output folder (default dist/components)
//   NF_BUILD_ID                the build id (default: the build time)
//   NF_COMPONENTS_SIGNING_KEY  private JWK: sign the descriptor (read by the plugin)
//   NF_BALLAST                 n: ~8n bytes of module data (memory checks)
import { nextFederationComponents } from '@next-federation/vite'
import { defineConfig } from 'vite'
import { lanePort } from '../../e2e/lane.ts'

const PORT = Number(process.env.PORT ?? lanePort(4110))

export default defineConfig({
  define: {
    __NF_FIXTURE_BUILD__: JSON.stringify(process.env.NF_BUILD_ID ?? 'dev'),
    __NF_BALLAST__: String(Number(process.env.NF_BALLAST ?? 0)),
  },
  plugins: [
    nextFederationComponents({
      name: 'components',
      base: `http://127.0.0.1:${PORT}/`,
      exposes: {
        './Counter': './src/Counter.tsx',
        './NavLink': './src/NavLink.tsx',
        './PagesNavLink': './src/PagesNavLink.tsx',
        './Versioned': './src/Versioned.tsx',
        // Throws while rendering (render-error handling).
        './Boom': './src/Boom.tsx',
      },
      shared: {
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
      },
      // Publish the exposed modules' declarations (hosts' nf-types).
      types: true,
      outDir: process.env.NF_OUT ?? 'dist/components',
    }),
  ],
})
