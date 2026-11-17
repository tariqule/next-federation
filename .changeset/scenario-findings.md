---
'@next-federation/react': minor
'@next-federation/sdk': minor
'@next-federation/vite': minor
'@next-federation/island': minor
---

Remote components: a component that throws while the server renders it no longer fails `next build` on a statically prerendered page. React error boundaries do not run on the server, so the host catches an error thrown by the exposed function component's own render, renders `fallback` marked for the browser, logs the new `NF-040` (once per build, expose and message) and lets the browser render the component after hydration. In the browser, the boundary now reports render errors: `NF-040` in the console and a `component:error` event (`nf:component`) with `remote`, `expose`, `buildId` and `error`; load failures stay reported by the runtime only. `createRemoteComponent` takes `errorFallback` (option and prop, default `fallback`), shown when the remote is unreachable, its module did not load or it threw; `fallback` is the loading state.

`@next-federation/vite`: `react-server-dom-webpack` is an optional peer dependency, so npm installs a components remote on any React 19 (it never uses it). `nextFederationIslands` fails with `NF-002` and the install command for the project's React version when it is missing. A components remote's dev server warns `NF-002` once when a browser opens a page of the project, pointing to the two-config setup for keeping a standalone app. `actions.timeoutMs` (island remotes) bounds Server Action calls in the browser: a call whose response has not started in time is aborted and rejects with `NF-038` (default: no limit).
