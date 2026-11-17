// Not a Server Action file. Importing it has a visible side effect, which
// `whoami()` reports: the dev action route must refuse an id naming this file
// before importing it (the allowlist), so the count stays 0.
const slot = globalThis as { __fixtureSideEffects?: number }
slot.__fixtureSideEffects = (slot.__fixtureSideEffects ?? 0) + 1

export async function poke(): Promise<string> {
  return 'poked'
}
