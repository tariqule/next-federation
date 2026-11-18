# Architecture

How `next-federation` works, for people who use it and people who change it. It covers the two
features (islands and remote components), what a host trusts, and the design choices behind both.
For the wire format see the [island protocol](protocol/v1.md); for task-oriented docs see the
[docs index](README.md).

## The idea

A **host** is the app your users visit. A **remote** is a separate app, deployed on its own, that
provides UI to the host at runtime. Neither needs a rebuild when the other deploys.

`next-federation` offers two ways to put a remote's UI in a host page. Both columns below describe
what a remote provides and how the host uses it:

| | Islands | Remote components |
| --- | --- | --- |
| The remote ships | Server-rendered HTML and its own React tree | A client component module |
| Where the remote's code runs | On the remote's server, then in the browser | In the host's browser, and on the host's server for signed or pinned builds |
| React it runs on | The remote's own | The host's |
| Props | Plain JSON | Anything, including functions and children |
| Host context | Does not cross over | Shared |
| Remote code on the host server | Never | Only for signed or pinned builds (see [Server rendering and the trust model](#server-rendering-and-the-trust-model)) |

Both work with remotes on any origin, and neither uses Next.js internals. Framework-specific code is
confined to small adapters that call public Next.js APIs, so a Next.js upgrade does not need a change
in the rest of the library. Next.js 14 and React 18 are not supported.

## Islands

An island is a piece of UI that a remote renders on its own server, using real React Server
Components, and that the host embeds as a separate React root.

### Request and envelope

1. The host asks the remote for an island: `GET <remote>/_nf/island/<name>?p=<props>`. The props are
   canonical JSON (sorted keys), so equal props produce equal URLs and a CDN or the host's cache can
   store the response. Large props go in a `POST` instead.
2. The remote renders the island to HTML and to an RSC (Flight) payload, and answers with a JSON
   **envelope**: the HTML, the payload, absolute stylesheet URLs, the URL of a bootstrap ES module,
   the build id and the React version.
3. The host validates the envelope. The bootstrap and stylesheet URLs must be `http(s)` on the
   remote's configured origins, or the island renders its fallback.
4. The host puts the HTML in the page. In the browser it loads the bootstrap module, which hydrates
   the island with the island's own React.

The fetch happens on the host's server, so the first paint already contains the island. A remote that
is down, slow or invalid shows a fallback and never breaks the page. The full contract, including
status codes and caching headers, is in the [protocol spec](protocol/v1.md).

### Mounting

The host mounts each island with `IslandMount` (`@next-federation/react`). A few rules keep the
island stable inside someone else's React tree:

- The island root belongs to its container DOM node, not to an effect. Strict Mode's double effects,
  and the hidden `<Activity>` that Next.js `cacheComponents` keeps visited routes in, leave a live
  island untouched.
- The HTML is written once. When the host re-renders (soft navigation, `router.refresh()`), the mount
  hands the new RSC payload to the existing root. It does not refetch from the remote.
- Each mount gets a unique id prefix, so two copies of one island on a page never share element ids.
- Errors inside the island do not reach the host's error boundaries, because it is a separate root.
  The mount reports them through events and shows the fallback.

### Identity

A **private island** renders for the signed-in user. The host signs a short-lived ES256 token whose
audience is the remote's name, and sends it as `Authorization: Bearer` with the island request. The
host publishes its public keys as a JWKS. The remote fetches them from the URL in its own `issuers`
configuration, never from a URL taken from the token, and verifies the token before it renders.

Tokens are minted on the host's server and never appear in HTML, the RSC payload, `__NEXT_DATA__` or
browser storage. In the browser, an island asks the host's same-origin token endpoint for a fresh
token and keeps it in memory. A response to a request that carried a token is `private, no-store`.
See [Identity](guides/identity.md).

### Skew pinning

Every URL in an envelope is absolute and pinned to the build that rendered the island
(`<remote>/b/<buildId>/...`). An envelope that a host cached keeps working for as long as that build
is still served, and a Server Action posts to the same build that rendered its island.

When a remote deploys, hosts with cached pages keep serving islands from the old build. The remote
keeps old builds available for a retention window (`nf-serve` keeps the current build, the newest
three and any younger than 24 hours). A build past retention answers `410` (`NF-023`); the island
stays visible but inert until the host refetches. If a host re-render delivers an island from a new
build, the mount tears down the old root and bootstraps the new one. See
[Self-hosted skew](guides/self-hosted-skew.md) and [Deploying a remote on Vercel](guides/deploying-a-remote-on-vercel.md).

### Caching in the host

Caching follows the host's caching model. A public island stays inside the page's static or ISR
output: with `cacheComponents` it renders in a `'use cache'` scope, and without it the envelope is
fetched with `next: { revalidate, tags }`. A private island needs the user's identity, so it is a
dynamic hole under a `<Suspense>` boundary (with `cacheComponents`) or makes the route dynamic
(without). The library never silently turns a static page dynamic. See [Caching](guides/caching.md).

### Sharing React between islands

Each island remote ships its own React, which costs about 75 KB of gzipped JavaScript per remote.
Production remotes on the same exact React version share one copy through a Module Federation share
scope named `nf-islands`. A remote on a different version uses its own copy, so sharing is an
optimisation and never couples a remote to the host's React. An SPA or Pages Router host on the same
stable React can lend its own with `provideHostReact()`. App Router hosts never do, because Next.js
runs its own React build. The flight client (`react-server-dom-webpack/client`) is never shared.
See [Limits](guides/limits.md#cost).

## Remote components

A remote component is a client component that the remote builds as a Module Federation 2.0 module.
The host loads it through the Module Federation runtime and renders it in its own tree, so it shares
the host's React, context and router.

### Loading

The remote's build writes a **descriptor** (`nf-components.json`) next to the module federation
manifest. It lists the build id, the manifest URL, the sha384 of every server file, and the
stylesheets and JavaScript chunks of each exposed module, all as absolute build-pinned URLs. The host
fetches the descriptor, then:

- in the browser, loads the component through the Module Federation runtime, with React, React DOM
  and any other `shared` modules supplied by the host;
- on the server of a Next.js host, evaluates the remote's server build and renders the component to
  HTML, if the descriptor is verified (below). The browser then hydrates it;
- in a client-only host, or for an unverified build, renders only in the browser. The server sends the
  component's `fallback`.

The remote declares which modules it shares with the host. The host checks the shared modules each
exposed module needs before it loads, and renders the fallback when one is missing or outside the
version range. A remote can bundle its own copy of a non-React module as a fallback.

### Server rendering and the trust model

Server rendering means running code fetched over the network inside the host's server process. If
the remote's CDN were compromised, that code would run with the host's secrets. So the host runs a
remote's server build only when both of these hold:

1. **The descriptor is verified in that process.** Either it carries an ES256 signature that checks
   against one of the public keys you configure for the remote, or the host's configuration pins the
   build's id to its digest.
   `unsafe-dev` (no verification) is accepted only when `NODE_ENV` is `development` or `test`.
2. **Every fetched file matches its sha384** from the descriptor, checked before anything is
   evaluated.

The host evaluates the code with `new Function`, never writes it to disk and never `import()`s it,
and it refuses its own Node script loader. A build whose manifest lists further remotes, or that has
no manifest the loader can check, renders in the browser only. Memory is bounded: each router layer
keeps at most `maxBuilds` builds of a remote (default 5) and evicts the oldest. A host with both
routers has two layers, because the App Router and the Pages Router run separate copies of React in
one server process. Details and
options are in [Remote components](guides/remote-components.md).

## What the host trusts

- **Island remotes.** The host accepts envelopes only from the origins you configure for a remote
  (plus its declared `assetOrigins`), refuses redirects, and checks every bootstrap and stylesheet
  URL against that list. Island HTML has scripts and head tags stripped, but that is cleanup, not a
  security boundary: an island remote can run script in your page, so list only remotes you trust.
- **Remote components.** A remote component is code you load into your page, and for verified builds
  into your server. Trust a remote the way you trust a dependency.
- **Identity.** A remote trusts only the issuers in its own `issuers` map. The host's tokens are
  scoped to one remote's audience, they expire (300 seconds by default, 900 at most), and host cookies
  are never sent to remotes.

Report a suspected vulnerability as described in [SECURITY.md](../SECURITY.md).

## Design choices

- **No Next.js internals.** An earlier generation of Next.js federation tooling broke on Next.js
  releases because it depended on private compiler and output details. Here, the packages that are not
  adapters import no framework, and the Next.js adapter uses only documented APIs. ESLint and
  `pnpm guardrail` enforce it.
- **A bundler-neutral protocol.** An island remote is anything that serves the envelope and a
  bootstrap module that exports `mountIsland`. `@next-federation/vite` is one implementation of it.
- **Isolation by build.** Islands keep per-build state in one registry (`globalThis.__nf_rsc__`, keyed
  by the build's base URL), so two remotes, or two builds of one remote, can share a page. Library
  code creates no other browser globals.
- **Islands do not use the host's React.** The RSC wire format is only guaranteed between identical
  React versions, and a Next.js App Router host runs a canary React. Each island root runs on its own
  React, shared between remotes only when versions match exactly.
- **Remote servers run in their own process.** A remote's RSC runtime keeps process-wide state, so
  `nf-serve` runs each retained build as a separate process.
- **Server Actions run on the remote.** The browser posts straight to the build that rendered the
  island, with a bearer token and no cookies. The host is not involved. See
  [Server Actions](guides/server-actions.md).
- **Failures degrade.** A remote that is down, slow, invalid or unverified shows a fallback. It never
  breaks the page and never breaks a static page's caching.

## Packages

| Package | Role |
| --- | --- |
| `@next-federation/sdk` | Error codes and the logger |
| `@next-federation/protocol` | Envelope, request codec, descriptor and trust types |
| `@next-federation/core` | Config, island fetch, identity tokens, descriptor verification |
| `@next-federation/react` | `IslandMount`, error boundary, remote components runtime |
| `@next-federation/server` | Island request handler, identity verifier, `nf-serve` |
| `@next-federation/island` | Remote-side runtime: `Link`, `Form`, `getIdentity`, bootstrap |
| `@next-federation/vite` | Vite plugins for island remotes and components remotes |
| `@next-federation/next` | Next.js adapter: `withNextFederation`, `RemoteIsland`, routes |

`sdk`, `protocol`, `core`, `react`, `server` and `island` import no framework. Contributors: see
[AGENTS.md](../AGENTS.md) for the repo map and the rules that keep it that way.
