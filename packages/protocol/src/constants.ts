export const PROTOCOL_VERSION = 1
export const ISLAND_PATH = '/_nf/island/'
export const HEALTH_PATH = '/_nf/health'
/** Reserved for Phase 3 (server actions). */
export const ACTION_PATH = '/_nf/action'
/** Longest base64url `p` value sent over GET; longer props are POSTed. */
export const GET_PROPS_LIMIT = 2048
export const NAME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_-]*$/
/** Default request body limit for a server, in bytes (POST island requests). */
export const DEFAULT_MAX_BODY_BYTES = 65536
/** `idPlaceholder` must match this: non-empty, URL- and id-safe, long enough to be unique. */
export const ID_PLACEHOLDER_PATTERN: RegExp = /^[A-Za-z0-9_-]{4,}$/
/**
 * Name of the browser global holding per-build Flight module registries. Shared by the island
 * bootstrap and the Vite plugin so a rename cannot desynchronise them.
 */
export const FLIGHT_REGISTRY_GLOBAL = '__nf_rsc__'
