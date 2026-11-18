// `pnpm examples:keys`: writes the examples' DEMO keys into git-ignored
// .env.local files (never commit them):
//   next-app-router/.env.local, next-pages-router/.env.local
//     NF_SIGNING_KEY            the host's private identity key (ES256 JWK)
//     NF_COMPONENTS_PUBLIC_KEY  the components remote's public key
//   components-remote/.env.local
//     NF_COMPONENTS_SIGNING_KEY the private key its builds are signed with
// Existing files are kept; `--force` writes new keys.
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const examples = join(import.meta.dirname, '..')
const FILES = {
  app: join(examples, 'next-app-router', '.env.local'),
  pages: join(examples, 'next-pages-router', '.env.local'),
  components: join(examples, 'components-remote', '.env.local'),
}

/** A private EC P-256 JWK (ES256), with a key id. */
export function privateJwk(kid) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return { ...privateKey.export({ format: 'jwk' }), kid }
}

// Single quotes: the values are JSON.
const line = (name, value) => `${name}='${JSON.stringify(value)}'\n`
const HEADER =
  '# Demo keys from `pnpm examples:keys`. Never commit this file.\n'

export function ensureKeys({ force = false } = {}) {
  if (!force && Object.values(FILES).every((file) => existsSync(file))) {
    return false
  }
  const month = new Date().toISOString().slice(0, 7)
  const components = privateJwk(`example-components-${month}`)
  const { d: _private, ...componentsPublic } = components
  void _private
  for (const host of ['app', 'pages']) {
    writeFileSync(
      FILES[host],
      HEADER +
        line('NF_SIGNING_KEY', {
          ...privateJwk(`example-${host}-${month}`),
          alg: 'ES256',
        }) +
        line('NF_COMPONENTS_PUBLIC_KEY', componentsPublic)
    )
  }
  writeFileSync(
    FILES.components,
    HEADER + line('NF_COMPONENTS_SIGNING_KEY', components)
  )
  return true
}

if (import.meta.filename === process.argv[1]) {
  const written = ensureKeys({ force: process.argv.includes('--force') })
  console.log(
    written
      ? `examples: wrote demo keys to\n  ${Object.values(FILES).join('\n  ')}`
      : 'examples: demo keys already exist (pass --force to replace them)'
  )
}
