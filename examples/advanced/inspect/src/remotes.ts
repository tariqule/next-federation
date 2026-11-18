// Who serves what, for the labels. Plain data the hosts already know from
// their federation config; nothing here comes from a remote.
export const REMOTES = {
  cdp: {
    label: 'CDP',
    long: 'category page',
    kind: 'island',
    tech: 'Vite island remote',
  },
  pdp: {
    label: 'PDP',
    long: 'product detail page',
    kind: 'island',
    tech: 'Vite island remote',
  },
  serp: {
    label: 'SERP',
    long: 'search results page',
    kind: 'island',
    tech: 'Vite island remote',
  },
  account: {
    label: 'Account',
    long: 'orders, profile, admin',
    kind: 'island',
    tech: 'Vite island remote with Server Actions',
  },
  header: {
    label: 'Header',
    long: 'header, mini cart, search box',
    kind: 'remote component',
    tech: 'Rspack + Module Federation 2.0',
  },
} as const

export type RemoteName = keyof typeof REMOTES

/**
 * How the host configured a piece (from the code that renders it, not
 * measured): `static` in the prerendered shell, `streamed` behind its own
 * Suspense per request, `blocking` in the first HTML per request,
 * `per-request` rendered on every request without streaming (Pages Router
 * getServerSideProps), `browser` fetched and rendered in the browser (SPA).
 */
export type CacheMode =
  | 'static'
  | 'streamed'
  | 'blocking'
  | 'per-request'
  | 'browser'

export type Router = 'App Router' | 'Pages Router' | 'React Router (SPA)'

/** What a host knows about one embedded piece. Plain JSON: no secrets. */
export type EmbedInfo = {
  kind: 'island' | 'remote component' | 'host component'
  remote?: RemoteName
  name: string
  router: Router
  cache: CacheMode
  /** Seconds, for cached public islands and descriptors. */
  revalidate?: number
  isPrivate?: boolean
  /** The remote build, when the host knows it on the server (components). */
  buildId?: string
  /** Where it sits: host page, layout... (outermost first). */
  trail: string[]
  /** Extra facts the host knows, one line each. */
  notes?: string[]
}
