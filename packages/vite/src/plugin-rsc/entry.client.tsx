// The remote's `client` entry: the module that an envelope's `bootstrap` URL
// points at. In production builds that share React, `nf:share` serves an
// async boundary in its place: it awaits the island share scope, then imports
// `./bootstrap.client.tsx` (see ../share.ts).
export { mountIsland } from './bootstrap.client.tsx'
