import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfies } from '@next-federation/protocol'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function peers(pkg: string): Record<string, string> {
  const json = JSON.parse(
    readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8')
  ) as { peerDependencies: Record<string, string> }
  return json.peerDependencies
}

describe('react and react-dom peer ranges', () => {
  for (const pkg of ['react', 'next']) {
    for (const dep of ['react', 'react-dom']) {
      const range = () => peers(pkg)[dep] as string

      it(`@next-federation/${pkg} accepts React 18.3 and 19 for ${dep}`, () => {
        for (const version of ['18.3.1', '19.0.0', '19.3.1']) {
          expect(satisfies(version, range())).toBe(true)
        }
      })

      it(`@next-federation/${pkg} rejects React 18.2 and 20 for ${dep}`, () => {
        for (const version of ['18.2.0', '20.0.0']) {
          expect(satisfies(version, range())).toBe(false)
        }
      })
    }
  }
})
