// The `browser` (and default) export of the server loader: browsers never
// evaluate remote server code, so the loader is not part of a client bundle.
import type { ServerLoader } from './server-loader.ts'

export type { ServerLoader }

export const serverLoader: ServerLoader | null = null

export function canLoadServerCode(): boolean {
  return false
}
