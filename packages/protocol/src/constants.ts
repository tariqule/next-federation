export const PROTOCOL_VERSION = 1
export const ISLAND_PATH = '/_nf/island/'
export const HEALTH_PATH = '/_nf/health'
/** Server Action endpoint, appended to the build-pinned public base. */
export const ACTION_PATH = '/_nf/action'
/** Request header naming the Server Action to run (lower-case, as `Headers` reports it). */
export const ACTION_HEADER = 'x-nf-action'
/**
 * A Server Action id: `<file>#<export>`. Callers also reject ids containing `..` or NUL
 * (see `isActionId`).
 */
export const ACTION_ID_PATTERN: RegExp =
  /^[A-Za-z0-9/_.@+-]{1,512}#[A-Za-z_$][A-Za-z0-9_$]{0,127}$/
/** Default Server Action request body limit, in bytes. */
export const DEFAULT_MAX_ACTION_BODY_BYTES = 1_048_576
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
/** A build id: a leading letter or digit, then up to 127 of `A-Za-z0-9._-` (URL- and path-safe). */
export const BUILD_ID_PATTERN: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
/** A Subresource Integrity sha384 value: `sha384-<base64>`. */
export const SHA384_PATTERN: RegExp = /^sha384-[A-Za-z0-9+/]+={0,2}$/
