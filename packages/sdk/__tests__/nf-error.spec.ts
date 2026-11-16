import {
  ERROR_CODES,
  NFError,
  errorDocsUrl,
  formatError,
  isNFError,
} from '../src/index.ts'

test('message carries code, title, detail and docs link', () => {
  const e = new NFError('NF-001', 'Remote "shop" is not in defineFederation().')
  expect(e.message).toBe(
    'NF-001: Unknown remote. Remote "shop" is not in defineFederation(). See https://github.com/tariqule/next-federation/blob/main/docs/errors/unknown-remote.md'
  )
  expect(e.code).toBe('NF-001')
  expect(e.name).toBe('NFError')
  expect(e.docs).toBe(errorDocsUrl('NF-001'))
  expect(e).toBeInstanceOf(Error)
  expect(isNFError(e, 'NF-001')).toBe(true)
  expect(isNFError(e, 'NF-002')).toBe(false)
  expect(isNFError({ code: 'NF-001', message: 'x' })).toBe(true)
  expect(isNFError(new Error('x'))).toBe(false)
  expect(isNFError(null)).toBe(false)
  expect(isNFError({ code: 'E_OTHER' })).toBe(false)
})

test('detail segment is omitted when absent', () => {
  expect(formatError('NF-021')).toBe(
    'NF-021: Unknown island. See https://github.com/tariqule/next-federation/blob/main/docs/errors/unknown-island.md'
  )
})

test('cause is preserved', () => {
  const cause = new Error('boom')
  expect(new NFError('NF-007', 'x', { cause }).cause).toBe(cause)
  expect(new NFError('NF-007', 'x').cause).toBeUndefined()
})

test('codes are NF-001..NF-030 then NF-036 (NF-031..035 reserved), unique slugs', () => {
  const expected = [
    ...Array.from(
      { length: 30 },
      (_, i) => `NF-${String(i + 1).padStart(3, '0')}`
    ),
    'NF-036',
  ]
  expect(Object.keys(ERROR_CODES)).toEqual(expected)
  const slugs = Object.values(ERROR_CODES).map((c) => c.slug)
  expect(new Set(slugs).size).toBe(expected.length)
  for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
})
