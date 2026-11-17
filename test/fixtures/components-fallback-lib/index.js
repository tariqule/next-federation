// A library the remote components fixture shares with `fallback: true`
// (mode-a-next.spec.ts): the remote bundles this copy and uses it when the
// host provides none, or a version outside the remote's `requiredVersion`.
// A host that provides a satisfying version passes its own module object.
export const copy = 'bundled'
export const version = '2.0.0'
