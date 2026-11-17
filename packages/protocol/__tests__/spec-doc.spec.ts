import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ERROR_CODES } from '@next-federation/sdk'
import {
  ACTION_ID_PATTERN,
  ACTION_PATH,
  DEFAULT_MAX_ACTION_BODY_BYTES,
  DEFAULT_MAX_BODY_BYTES,
  GET_PROPS_LIMIT,
  HEALTH_PATH,
  ID_PLACEHOLDER_PATTERN,
  ISLAND_PATH,
  parseEnvelope,
} from '../src/index.ts'

// Walks up from the working directory, so it works from the repo root or the package.
function findSpec(): string {
  for (let dir = resolve('.'); ; dir = dirname(dir)) {
    const file = join(dir, 'docs/protocol/v1.md')
    if (existsSync(file)) return file
    if (dirname(dir) === dir) throw new Error('docs/protocol/v1.md not found')
  }
}

const spec = readFileSync(findSpec(), 'utf8')

test('the first json block in the published spec parses as an envelope', () => {
  const match = /```json\n([\s\S]*?)\n```/.exec(spec)
  expect(match).not.toBeNull()
  expect(parseEnvelope(JSON.parse(match?.[1] ?? '')).protocolVersion).toBe(1)
})

test('the spec states the endpoint precedence', () =>
  expect(spec).toMatch(/health[\s\S]*OPTIONS[\s\S]*Origin/))

test('every NF code in the spec exists in the sdk, and the status table codes are listed', () => {
  const cited = new Set(spec.match(/NF-\d{3}/g) ?? [])
  for (const code of cited) {
    expect(Object.keys(ERROR_CODES)).toContain(code)
  }
  const table = spec.slice(
    spec.indexOf('## Status codes'),
    spec.indexOf('## Caching')
  )
  for (const code of [
    'NF-004',
    'NF-014',
    'NF-015',
    'NF-016',
    'NF-021',
    'NF-022',
    'NF-023',
  ]) {
    expect(table).toContain(code)
  }
})

test('the spec quotes the constants the code uses', () => {
  for (const value of [
    String(GET_PROPS_LIMIT),
    String(DEFAULT_MAX_BODY_BYTES),
    ISLAND_PATH,
    HEALTH_PATH,
    ACTION_PATH,
    ID_PLACEHOLDER_PATTERN.source,
  ]) {
    expect(spec).toContain(value)
  }
})

test('the example envelope uses a placeholder the pattern accepts', () => {
  const match = /```json\n([\s\S]*?)\n```/.exec(spec)
  const { idPlaceholder } = JSON.parse(match?.[1] ?? '')
  expect(ID_PLACEHOLDER_PATTERN.test(idPlaceholder)).toBe(true)
})

test('the spec documents Server Actions and no longer reserves them', () => {
  expect(spec).not.toContain('## Reserved')
  const section = spec.slice(spec.indexOf('## Server Actions'))
  expect(spec).toContain('## Server Actions')
  for (const value of [
    ACTION_ID_PATTERN.source,
    String(DEFAULT_MAX_ACTION_BODY_BYTES),
    'X-NF-Action',
    'text/x-component',
    'NF-031',
    'NF-032',
    'NF-033',
    'NF-014',
    'NF-015',
    'NF-021',
    'NF-023',
    'invalidateToken',
    'onAction',
  ]) {
    expect(section).toContain(value)
  }
})
