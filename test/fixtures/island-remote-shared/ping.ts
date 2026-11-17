'use server'

// Outside the island-remote root, reached through a symlink
// (island-remote/src/linked/ping.ts): in dev its action id is a `/@fs/...` path.
export async function ping(): Promise<string> {
  return 'pong'
}
