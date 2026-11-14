import rsc from '@vitejs/plugin-rsc';
import { defineConfig, type Plugin } from 'vite';

const PORT = Number(process.env.PORT ?? 4100);
const ORIGIN = `http://127.0.0.1:${PORT}`;

// Per-remote flight-client scope (design §6 "no shared globals"). plugin-rsc rewrites the flight
// client's __webpack_require__ to a page-global __vite_rsc_require__. Two remotes on one page would
// overwrite each other, so the browser flight client is re-pointed at a registry entry keyed by this
// remote's origin. (A true module-scoped binding is impossible in dev: the client is pre-bundled.)
const SLOT = `globalThis.__nf_rsc__[${JSON.stringify(ORIGIN)}]`;
const scopeFlightClient = (code: string) =>
  code
    .replaceAll('__vite_rsc_require__', `${SLOT}.require`)
    .replaceAll('__webpack_require__.u', '({}).u')
    .replaceAll('__webpack_require__', `${SLOT}.require`)
    .replaceAll('__webpack_chunk_load__', `${SLOT}.chunkLoad`);
const FLIGHT_CLIENT = /react-server-dom-webpack-client\.browser/;

function nfScope(): Plugin {
  // Build: the flight client goes through the normal plugin pipeline.
  return {
    name: 'nf:scope-flight-client',
    enforce: 'post',
    applyToEnvironment: (env) => env.name === 'client',
    transform: {
      filter: { id: FLIGHT_CLIENT },
      handler: (code) => ({ code: scopeFlightClient(code), map: null }),
    },
  };
}

// Dev: the flight client is pre-bundled by the dependency optimizer, which needs its own plugin.
const nfScopeOptimizer = {
  name: 'nf:scope-flight-client-optimizer',
  transform: {
    filter: { id: FLIGHT_CLIENT },
    handler: (code: string) => ({ code: scopeFlightClient(code), map: null }),
  },
};

export default defineConfig({
  // plugin-rsc requires an absolute base for RSC asset URLs (design §2, §6 build pinning).
  base: `${ORIGIN}/`,
  // Remotes A and B run from this one folder: separate optimizer caches, since the pre-bundled
  // flight client embeds the remote's origin.
  cacheDir: `node_modules/.vite-${process.env.NF_REMOTE ?? 'a'}`,
  // No @vitejs/plugin-react: Fast Refresh globals would clash with the host's refresh runtime
  // when island modules load cross-origin. Vite's built-in oxc compiles JSX.
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  plugins: [
    rsc({
      entries: {
        rsc: './src/entry.rsc.tsx',
        ssr: './src/entry.ssr.tsx',
        client: './src/bootstrap.tsx',
      },
      // Islands must not emit hoistable <link precedence> tags; CSS URLs go in the envelope instead.
      rscCssTransform: false,
    }),
    nfScope(),
  ],
  define: {
    'import.meta.env.NF_REMOTE': JSON.stringify(process.env.NF_REMOTE ?? 'a'),
    'import.meta.env.NF_ORIGIN': JSON.stringify(ORIGIN),
  },
  environments: {
    client: {
      optimizeDeps: { rolldownOptions: { plugins: [nfScopeOptimizer] } },
    },
  },
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
    cors: { origin: [/^http:\/\/localhost:\d+$/] },
  },
});
