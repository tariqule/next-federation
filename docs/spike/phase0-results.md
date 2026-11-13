# Phase 0 spike results

## Prior art (read-only study of remote-components@0.4.16 and @module-federation/vite@1.24.0)

- **remote-components** shares the **host's** React (one separate `hydrateRoot` per remote, inside a shadow root) and injects host React into each remote's webpack module table. That is the opposite of our "island brings its own React" model.
- It scopes by **namespace, not isolation**. There is one global `self.__webpack_require__` dispatcher. Client-reference ids are rewritten on the server to `"[bundle] id"` and dispatched by prefix in the browser to `__remote_webpack_require__[bundle]`. Turbopack chunk globals are regex-renamed per remote.
- It depends on Next internals (`__RSC_MANIFEST`, `getWorkStore`, `_next` paths). It **does not** meet our no-internals or no-page-globals rules, so we reuse ideas only.
- **@module-federation/vite ISLAND mode** keeps React private to each remote's ESM graph (dynamic `import("react-dom/client")` inside the remote). On the server it uses classic `renderToString` (not RSC), and it hydrates with `hydrateRoot(el, createElement(Component, props))`. The host wrapper injects the HTML and calls the remote's `hydrate()` in an effect. CSS URLs are resolved from `import.meta.url` and de-duplicated.
- Neither package gives `react-server-dom-webpack/client` a per-remote loader without globals.
- **Reuse for Task 5:**
  1. each island bootstrap is its own ESM graph with its own React (MF ISLAND pattern);
  2. rewrite the flight client's module-loading global to a module-scoped function at build time;
  3. **safety net:** prefix client-reference ids with the remote name on the server and assert the prefix in the loader, so a payload routed to the wrong island fails loudly (remote-components idea);
  4. `callServer` per root via `createFromReadableStream` options.
