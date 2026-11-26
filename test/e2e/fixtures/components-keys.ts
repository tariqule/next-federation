// TEST-ONLY key pair for the remote components e2e: the components remote
// fixture signs its build descriptors with the private key
// (NF_COMPONENTS_SIGNING_KEY), the hosts trust the public key. Never use it
// outside tests.
// No imports: Next and Vite fixture configs import this file.
export const COMPONENTS_SIGNING_KEY = {
  kty: 'EC',
  crv: 'P-256',
  x: 'BxIF2oOXiu56docUlS0qXBea4bhypb904VsucsD45ZE',
  y: 'OBPlHPzBRZt-2BLuU19sIFx_dhOU_m8YrwdV7V0Z--4',
  d: 'iZHjoTpZpj1sRmm6QjMGe8tLNN-ARvGYSjnFB1x-4sI',
  kid: 'nf-e2e-components-1',
} as const

export const COMPONENTS_PUBLIC_KEY = {
  kty: 'EC',
  crv: 'P-256',
  x: 'BxIF2oOXiu56docUlS0qXBea4bhypb904VsucsD45ZE',
  y: 'OBPlHPzBRZt-2BLuU19sIFx_dhOU_m8YrwdV7V0Z--4',
  kid: 'nf-e2e-components-1',
} as const

/** Components remote ports (before the lane offset, see lane.ts). */
export const COMPONENTS_PORTS = {
  /** Signed builds c1 (current). */
  signed: 4110,
  /** Signed t1 whose server chunk was changed after signing. */
  tampered: 4111,
  /** Unsigned u1. */
  unsigned: 4112,
  /** Started by mode-a.spec.ts itself: redeploy and skew (r1, r2). */
  redeploy: 4113,
  /** The Rspack-built remote (components-remote-rspack): signed rs1. */
  rspack: 4114,
  /** The Rspack-built remote, unsigned ru1. */
  rspackUnsigned: 4115,
  /**
   * Signed c18: the default exposes, accepting React '^18.3.0 || ^19.0.0'
   * (the React 18 hosts, NF_SUITE=react18 only).
   */
  react18: 4116,
  /**
   * Signed rm1, the links build: accepts @next-federation/router >=9.0.0
   * only (router.spec.ts).
   */
  routerMiss: 4117,
  /**
   * Signed s1 behind a proxy that holds every server-side (non-browser)
   * asset request for 20 s, then answers 503: a deterministic preload
   * timeout (preload.spec.ts). Browser requests pass straight through.
   */
  slow: 4118,
  /** Nothing listens here. */
  down: 4119,
  /**
   * The Rspack-built remote, signed rsm1: accepts @next-federation/router
   * >=0.99.0 only, so it loads its bundled copy (router.spec.ts).
   */
  rspackRouterMiss: 4120,
  /**
   * Signed l1, the links build: the Router* exposes, whose next/link,
   * next/navigation and react-router imports the build rewires
   * (router.spec.ts).
   */
  links: 4121,
} as const
