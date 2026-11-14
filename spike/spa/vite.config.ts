import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: 'http://localhost:4200/',
  plugins: [
    // Exposed modules run inside other apps, where Vite's Fast Refresh preamble is absent.
    react({ exclude: /src\/CartButton\.tsx$/ }),
    federation({
      name: 'spa',
      filename: 'remoteEntry.js',
      manifest: true,
      // Absolute, so hosts on other origins resolve remoteEntry.js here (the dev manifest
      // otherwise advertises "/", which a host resolves against its own origin).
      publicPath: 'http://localhost:4200/',
      dts: false,
      exposes: { './CartButton': './src/CartButton.tsx' },
      // The SPA is also a standalone app, so it keeps a React fallback; a host that registers its
      // own React wins as the singleton (design §7).
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom/client': { singleton: true, requiredVersion: '^19.0.0' },
        'react/jsx-runtime': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  server: { host: 'localhost', port: 4200, strictPort: true, cors: true },
});
