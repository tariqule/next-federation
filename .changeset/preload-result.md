---
'@next-federation/react': minor
'@next-federation/next': minor
'@next-federation/core': minor
'@next-federation/protocol': minor
---

Typed preload result, refusals honoured through hydration, `browserOnly` and lifecycle events for remote components.

- `Component.preload(descriptor, { timeoutMs })` and `preloadRemoteComponent(descriptor, expose, { timeoutMs })` resolve a `PreloadResult` (`ready`, `browser-only`, `refused`, `failed`, `timeout`, `no-descriptor`). `preload(descriptor)` is unchanged.
- Components take a `browserOnly` prop. It never overrides a refusal.
- Component events gain optional `phase` and `outcome`, and a new `component:fallback` event. Server events reach the `onEvent` of the federation that resolved the descriptor.
- `@next-federation/next/pages/server` now registers `next/link` and `next/router`.

**Behaviour change:** a build refused for integrity or trust (`NF-027`, `NF-028` for nested remotes or an uncheckable manifest, `NF-036`) now renders `errorFallback` on the server and after hydration, and is never requested by the browser. Before, the browser loaded a build after a server integrity failure.

**Type-level changes:** the `ComponentEvent` union gains `component:fallback`, and the core `FederationEvent` union gains `component:load` and `component:fallback`. A handler that switches over `type` without a `default` branch needs a new case. `RemoteComponentDescriptor` gains optional `refused` and `events`, and the protocol registry types gain optional fields.
