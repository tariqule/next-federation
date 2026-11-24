---
'@next-federation/react': minor
'@next-federation/next': minor
'@next-federation/vite': minor
'@next-federation/server': minor
'@next-federation/protocol': minor
---

React 18 hosts can embed islands and remote components. A Next 15 Pages Router host or a React 18
SPA runs on React 18.3 or 19. App Router hosts keep Next's own React.

- `@next-federation/react` and `@next-federation/next`: the `react` and `react-dom` peers widen
  from `^19.0.0` to `^18.3.0 || ^19.0.0`. No other package's peers change.
- `@next-federation/vite`: `nextFederationComponents` takes a new `react` option, a semver range
  (default `^19.0.0`) that declares the host React range a components remote accepts. Set `'^18.3.0 || ^19.0.0'`
  for a remote that runs in React 18 hosts. An invalid range throws `NF-002`.
- `@next-federation/server` (the descriptor, also for `nf-describe`): a build lists React's
  modules in its descriptor's `shared` only for a range other than `^19.0.0`, so a default build's
  descriptor and digest are unchanged. `@next-federation/react`: a host checks its React against
  `^19.0.0` for each React module a descriptor does not list, and renders the fallback with
  `NF-036` when it does not satisfy it. `@next-federation/protocol` exports `DEFAULT_REACT_RANGE`
  and `HOST_REACT_MODULES`, and refuses a descriptor whose React entry lists `exposes`.
- Upgrade App Router hosts to this release before widening a remote's React range: hosts on 0.1.x
  compare a listed range with their raw React version, and the canary React an App Router host
  runs matches none, so they render that remote's components as the fallback (`NF-036`). Remotes
  on the default range are unaffected.
- `nf-describe`: re-describing a Rspack or webpack build whose React shares declare a range other
  than `^19.0.0` (for example `^19.1.0` from `package.json`) now lists React, so its descriptor
  digest changes; a host that pinned the old digest refuses the build until the pin is updated.
  Hosts now enforce that listed range: a remote re-described with `^19.3.1` renders its fallback
  (`NF-036`) on an App Router host whose canary React is 19.3.0 by its release numbers, where an
  undeclared build loads. React shares without a readable range are left out (hosts assume
  `^19.0.0`), and `nf-describe` warns (`NF-036`).
