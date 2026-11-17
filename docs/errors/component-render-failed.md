# NF-040: Remote component threw while rendering

## What happened

A remote component (Mode A) threw an error while it rendered. The host keeps running and the page
still answers 200; only that component is affected.

- **On the server**: React error boundaries do not run during a server render, so the host catches
  the error the exposed component throws in its own render. The server HTML gets the component's
  `fallback`, marked for the browser, and the browser renders the component after hydration. The
  error is logged once per build, exposed module and message. A statically prerendered page still
  builds.
- **In the browser**: the component's error boundary renders `errorFallback` (default: `fallback`)
  for that build, logs the error and sends a `component:error` event (`nf:component` on
  `document`) with `code: 'NF-040'`, `remote`, `expose`, `buildId` and `error`.

## Why

- The component reads a browser-only API (`window`, `document`, `localStorage`) during render: it
  fails on the server only, and renders in the browser.
- The component has a bug, or gets props or a context value it does not expect: it fails in the
  browser too.
- A remote build that expects a newer version of a host-provided module (React context, router)
  than the host provides. Shared modules with a `requiredVersion` the host does not satisfy are
  refused before loading (`NF-036`) instead.

## How to fix

Fix the error in the remote and deploy a new build: hosts pick it up within the descriptor's
`revalidate`. Keep browser-only code in effects (`useEffect`) or render that part only after mount.

The server catches errors of the exposed function component's own render. An error from a
component it renders, or from a class, `memo` or `forwardRef` export, still reaches the host's
renderer: at request time the browser renders that part, and `next build` fails a build-time
prerender of a static page. Make such components safe to render on the server, or read the
descriptor with `{ dynamic: true }` on that page so it is rendered per request.
