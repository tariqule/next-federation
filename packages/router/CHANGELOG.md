# @next-federation/router

## 0.2.1

No changes in this release.

## 0.2.0

### Minor Changes

- 2155c1b: Remote links work in every host, and remotes keep their own router. A remote component writes its
  links with `next/link` and `next/navigation`, React Router, or a plain `<a href>`, unchanged. The
  remote build rewires those router imports, so one build navigates through the host's router: the
  App Router and the Pages Router (provided by `@next-federation/next`'s components entries), a host
  that calls `provideNavigation`, or full page loads where the host has none. A React Router link
  inside a router the remote renders itself (a `MemoryRouter`) keeps routing inside it. A plain
  `<a href>` is never intercepted. A link navigates through the host only for a path, query or
  fragment on the page's origin; `javascript:`, `vbscript:` and `data:` hrefs render no `href`.
  
  - `@next-federation/vite`: new `links` option (default true). `nextFederationComponents` rewires
    `next/link` and `next/navigation`, and `react-router` and `react-router-dom` when the remote's
    `package.json` lists one of them and `react-router` 7 resolves from the remote's root, to shims
    (React Router 6, or `react-router-dom` alone without a resolvable `react-router`: left as it is,
    with one `NF-002` warning). A specifier listed in `shared` keeps that sharing. It
    also shares the shims' runtime, `@next-federation/router`, by default with the plugin's own copy:
    `{ requiredVersion: '>=<major>.<minor>.0 <1.0.0', fallback: true }` on 0.x, `'^<version>'` from
    1.0. `links: false` turns both off.
  - `@next-federation/react`: `provideNavigation({ useNavigate, useHref?, useLocation? })`
    (`@next-federation/react/components`) gives remote links the host's router; React Router's own
    hooks fit as they are. The component runtime warns once per remote and module when the host's
    copy of a `fallback: true` module is outside the remote's range (`NF-036`, as a warning; the
    remote uses its own copy). A remote that bundles its own Module Federation runtime (Rspack,
    webpack) now resolves a module the host registered to the host's copy when it satisfies its
    range, otherwise to its own copy, never to another remote's copy (before, the first bundled
    copy one remote loaded was given to every later remote for the life of the host process).
    Other Module Federation instances and names are left alone. A Vite build whose range excludes
    the host's copy, while the host's copy is cached under its bundled version, renders in the
    browser only on the server. Ranges in `NF-036` messages are quoted. A build of a container
    loaded after the runtime replaced its Module Federation instance (a module registered late, as
    router hosts do, or a timed-out load) now loads that build; before, it could silently load the
    build of that container name loaded before the replacement.
  - `@next-federation/router` (new, internal: imported by generated shims and host modules, not by
    application code): the shims and the document router. Its `./build` entry has the Rspack and
    webpack helpers `routerShimAliases()` and `routerSharedEntry()` (the shared entry names the
    package, never a path of the build machine, so a published `remoteEntry.js` carries none).
  - `@next-federation/next`: the App Router and Pages Router components entries provide the host's
    router to rewired remote links. The `next/link`, `next/navigation` and `next/router` they share
    with remotes that list them in `shared` get the same guards: a link off the page's origin is a
    plain anchor (a script URL gets no `href`), and `push` or `replace` off it is dropped.
