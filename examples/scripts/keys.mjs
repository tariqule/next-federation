// `pnpm examples:keys`: writes the examples' DEMO keys into git-ignored
// .env.local files (never commit them):
//   next-app-router/.env.local, next-pages-router/.env.local
//     NF_SIGNING_KEY            the host's private identity key (ES256 JWK)
//     NF_COMPONENTS_PUBLIC_KEY  the components remote's public key
//   components-remote/.env.local
//     NF_COMPONENTS_SIGNING_KEY the private key its builds are signed with
// and for the advanced examples (examples/advanced):
//   advanced/storefront/.env.local
//     NF_SIGNING_KEY            the storefront's private identity key
//     NF_COMPONENTS_PUBLIC_KEY  the header remote's public key
//   advanced/header-remote-rspack/.env.local
//     NF_COMPONENTS_SIGNING_KEY the private key its builds are signed with
// Each set is written when one of its files is missing; `--force` writes new
// keys for both.
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const examples = join(import.meta.dirname, '..')
const FILES = {
  app: join(examples, 'next-app-router', '.env.local'),
  pages: join(examples, 'next-pages-router', '.env.local'),
  components: join(examples, 'components-remote', '.env.local'),
}
const ADVANCED = {
  storefront: join(examples, 'advanced', 'storefront', '.env.local'),
  header: join(examples, 'advanced', 'header-remote-rspack', '.env.local'),
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

const missing = (files) => !Object.values(files).every((f) => existsSync(f))

export function ensureKeys({ force = false } = {}) {
  const simple = force || missing(FILES)
  const advanced = force || missing(ADVANCED)
  if (simple) writeSimpleKeys()
  if (advanced) writeAdvancedKeys()
  return simple || advanced
}

function writeAdvancedKeys() {
  const month = new Date().toISOString().slice(0, 7)
  const header = privateJwk(`example-header-${month}`)
  const { d: _private, ...headerPublic } = header
  void _private
  writeFileSync(
    ADVANCED.storefront,
    HEADER +
      line('NF_SIGNING_KEY', {
        ...privateJwk(`example-storefront-${month}`),
        alg: 'ES256',
      }) +
      line('NF_COMPONENTS_PUBLIC_KEY', headerPublic)
  )
  writeFileSync(
    ADVANCED.header,
    HEADER + line('NF_COMPONENTS_SIGNING_KEY', header)
  )
}

function writeSimpleKeys() {
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
}

if (import.meta.filename === process.argv[1]) {
  const written = ensureKeys({ force: process.argv.includes('--force') })
  console.log(
    written
      ? `examples: wrote demo keys (missing sets only) to\n  ${[...Object.values(FILES), ...Object.values(ADVANCED)].join('\n  ')}`
      : 'examples: demo keys already exist (pass --force to replace them)'
  )
}
