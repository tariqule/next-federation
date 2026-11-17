// Parallel e2e lanes: NF_LANE picks a port offset and lane-scoped output
// folders, so two runs can share the checkout without colliding.
//   unset | 'a'   offset 0, today's ports and folders (the default lane)
//   'b'           offset +2000: 3100 -> 5100, 4100 -> 6100, 3999 -> 5999
//   'c'           offset +4000
//   'd'           offset +6000
// This file has no imports: fixture configs (Vite) import it too.
const OFFSETS: Record<string, number> = { a: 0, b: 2000, c: 4000, d: 6000 }

export function laneOffset(env: NodeJS.ProcessEnv = process.env): number {
  const lane = env.NF_LANE || 'a'
  const offset = OFFSETS[lane]
  if (offset === undefined) {
    throw new Error(
      `Unknown NF_LANE "${lane}": expected one of ${Object.keys(OFFSETS).join(', ')}`
    )
  }
  return offset
}

/** '' for the default lane, else the lane name (used to scope folders). */
export function laneName(env: NodeJS.ProcessEnv = process.env): string {
  laneOffset(env)
  const lane = env.NF_LANE || 'a'
  return lane === 'a' ? '' : lane
}

/** A base port moved into the lane's range. */
export const lanePort = (
  base: number,
  env: NodeJS.ProcessEnv = process.env
): number => base + laneOffset(env)
