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
  | 'NF-026'
  | 'NF-027'
  | 'NF-028'
  | 'NF-029'
  | 'NF-030'
  | 'NF-031'
  | 'NF-032'
  | 'NF-033'
  | 'NF-034'
  | 'NF-035'
  | 'NF-036'
  | 'NF-037'
  | 'NF-038'
  | 'NF-039'
  | 'NF-040'
  | 'NF-041'

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
      title: 'This remote build does not support island Server Actions',
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
    'NF-026': {
      slug: 'unsupported-module-federation-vite',
      title: 'Unsupported `@module-federation/vite` version',
    },
    'NF-027': {
      slug: 'component-integrity-failed',
      title: 'Remote component server code failed its integrity check',
    },
    'NF-028': {
      slug: 'component-browser-only',
      title: 'Remote component rendered in the browser only',
    },
    'NF-029': {
      slug: 'component-load-failed',
      title: 'Remote component failed to load',
    },
    'NF-030': {
      slug: 'component-require-refused',
      title:
        'Remote component server code required a module the host does not provide',
    },
    'NF-031': { slug: 'action-not-found', title: 'Server Action not found' },
    'NF-032': {
      slug: 'action-request-invalid',
      title: 'Server Action request is invalid',
    },
    'NF-033': { slug: 'action-failed', title: 'Server Action threw an error' },
    'NF-034': {
      slug: 'server-action-imported-by-client',
      title: "A client module imports a 'use server' file",
    },
    'NF-035': {
      slug: 'raw-form-action',
      title: 'Island form uses a raw `action` instead of `<Form>`',
    },
    'NF-036': {
      slug: 'component-shared-unavailable',
      title:
        'Host does not provide a shared module version the remote component accepts',
    },
    'NF-037': {
      slug: 'dev-debug-info',
      title: 'Under `next dev`, private island values may reach the browser',
    },
    'NF-038': {
      slug: 'action-request-failed',
      title: 'Server Action request failed',
    },
    'NF-039': {
      slug: 'component-deferred',
      title: 'Remote component deferred to request time',
    },
    'NF-040': {
      slug: 'component-render-failed',
      title: 'Remote component threw while rendering',
    },
    'NF-041': {
      slug: 'vulnerable-react-server-dom',
      title:
        'Installed `react-server-dom-webpack` has a known security advisory',
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
