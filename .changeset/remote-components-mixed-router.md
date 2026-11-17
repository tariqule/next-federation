---
'@next-federation/protocol': minor
'@next-federation/react': minor
---

Remote components server-render in mixed-router hosts (App Router and Pages Router routes in one Next.js host). Each router layer has its own remote component runtime: its own Module Federation host instance, its own sha384-checked copy of each remote build's server code, and its own copy of the globals that copy keeps its state in (a Vite remote's `__mf_module_cache__`/`__mf_init__…`, a Rspack or webpack remote's bundled `__FEDERATION__` registry), so a remote copy renders on the React of the route that renders it. This isolates cooperating builds; it is not a sandbox.

- Builds the server loader knows how to isolate (`@module-federation/vite` 1.24.0, `@module-federation/enhanced` 2.9.2 and 2.9.3) server-render in every layer. Any other build server-renders in one layer per process only and in the browser elsewhere (`NF-028`, logged once).
- A build whose manifest lists `remotes` of its own, or without a manifest the server loader could check, renders in the browser only on the server in every host (`NF-028`): its nested remotes would load outside the sha384 check.
- Fallback copies are never seeded for `react`, `react-dom`, `next` or any of their subpaths, and a fallback copy is checked by version as well as name.
- `@next-federation/protocol` no longer exports `NEVER_FALLBACK`: use `isNeverFallback(name)`, which covers every subpath of `react`, `react-dom` and `next`.
- A descriptor whose `shared` field says `fallback: true` for such a module (`react-dom/server`, `next/head`, ...) is refused as an invalid descriptor.
- A remote's server entry initialises in one layer at a time; an initialisation that waits more than 10 s fails and is retried after the cooldown instead of overlapping. A load timeout reuses the layer's scope, so repeated timeouts no longer grow memory.
- A failed load keeps its real error code (`NF-029` for a network failure, `NF-027` for a tampered file) instead of being reported as an unverified container.
- Remote server code is evaluated with `document`, `window` and `self` shadowed, so a server-side polyfill of those globals cannot make a remote's runtime use the real global object.
- Edge case: a server entry that declares `let` or `const` `document`, `window` or `self` at its top level cannot be evaluated this way (a `SyntaxError`: those names are parameters of the wrapper), so it does not server-render. `var` declarations and declarations inside functions are unaffected.
