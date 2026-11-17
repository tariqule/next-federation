// The published peer ranges: npm (unlike pnpm) refuses to install a peer
// outside them (ERESOLVE), so a range must not exclude versions a new
// project gets by default.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pkg = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')
) as {
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
}

test('typescript is an optional peer with no upper bound (create-vite installs TypeScript 7)', () => {
  // TypeScript 7 has no compiler API: `types: true` warns NF-002 at build
  // time instead of npm refusing to install every remote.
  expect(pkg.peerDependencies.typescript).toBe('>=5.0.0')
  expect(pkg.peerDependenciesMeta.typescript).toEqual({ optional: true })
})
