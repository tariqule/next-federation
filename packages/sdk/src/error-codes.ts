export const DOCS_BASE =
  'https://github.com/tariqule/next-federation/blob/main/docs/errors/'

export type NFErrorCode =
  | 'NF-001'
  | 'NF-002'
  | 'NF-003'
  | 'NF-004'
  | 'NF-005'
  | 'NF-006'
  | 'NF-007'
  | 'NF-008'
  | 'NF-009'
  | 'NF-010'
  | 'NF-011'
  | 'NF-012'
  | 'NF-013'
  | 'NF-014'
  | 'NF-015'
  | 'NF-016'
  | 'NF-017'
  | 'NF-018'
  | 'NF-019'
  | 'NF-020'
  | 'NF-021'
  | 'NF-022'
  | 'NF-023'
  | 'NF-024'
  | 'NF-025'

export const ERROR_CODES: Record<NFErrorCode, { slug: string; title: string }> =
  {
    'NF-001': { slug: 'unknown-remote', title: 'Unknown remote' },
    'NF-002': {
      slug: 'invalid-config',
      title: 'Invalid federation configuration',
    },
    'NF-003': {
      slug: 'unsupported-protocol-version',
      title: 'Unsupported island protocol version',
    },
    'NF-004': { slug: 'invalid-envelope', title: 'Invalid island envelope' },
    'NF-005': {
      slug: 'envelope-url-not-allowed',
      title: "Envelope URL is outside the remote's origins",
    },
    'NF-006': {
      slug: 'react-mode-mismatch',
      title: 'Island server and client bundle run different React modes',
    },
    'NF-007': { slug: 'island-fetch-failed', title: 'Island fetch failed' },
    'NF-008': {
      slug: 'island-fetch-timeout',
      title: 'Island fetch timed out',
    },
    'NF-009': {
      slug: 'props-not-json',
      title: 'Island props are not plain JSON',
    },
    'NF-010': {
      slug: 'build-mismatch',
      title: 'Envelope was rendered by a different build than this bootstrap',
    },
    'NF-011': {
      slug: 'bootstrap-load-failed',
      title: 'Island bootstrap failed to load',
    },
    'NF-012': {
      slug: 'island-runtime-error',
      title: 'Uncaught error inside an island',
    },
    'NF-013': {
      slug: 'identity-not-configured',
      title: 'Private island used without identity configuration',
    },
    'NF-014': { slug: 'invalid-token', title: 'Identity token rejected' },
    'NF-015': {
      slug: 'jwks-unavailable',
      title: 'Issuer JWKS could not be fetched',
    },
    'NF-016': {
      slug: 'issuer-not-allowed',
      title: "Token issuer is not in the remote's issuer map",
    },
    'NF-017': {
      slug: 'next-config-wrapper-missing',
      title: '`withNextFederation` is missing from next.config',
    },
    'NF-018': {
      slug: 'island-html-stripped',
      title: 'Island rendered a script or hoistable element',
    },
    'NF-019': {
      slug: 'server-actions-unsupported',
      title: 'Island Server Actions are not available in this release',
    },
    'NF-020': {
      slug: 'relative-base',
      title: 'Remote `base` must be an absolute URL',
    },
    'NF-021': { slug: 'unknown-island', title: 'Unknown island' },
    'NF-022': {
      slug: 'origin-not-allowed',
      title: 'Request origin is not an allowed host',
    },
    'NF-023': {
      slug: 'build-retired',
      title: 'Remote build has been retired',
    },
    'NF-024': {
      slug: 'envelope-too-large',
      title: 'Island envelope exceeds the size warning threshold',
    },
    'NF-025': {
      slug: 'unsupported-plugin-rsc',
      title: 'Unsupported `@vitejs/plugin-rsc` version',
    },
  }

export function errorDocsUrl(code: NFErrorCode): string {
  return `${DOCS_BASE}${ERROR_CODES[code].slug}.md`
}

export function formatError(code: NFErrorCode, detail?: string): string {
  const head = `${code}: ${ERROR_CODES[code].title}.`
  const body = detail ? ` ${detail}` : ''
  return `${head}${body} See ${errorDocsUrl(code)}`
}
