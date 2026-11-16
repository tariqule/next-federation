import { logger } from '@next-federation/sdk'
import {
  BUILD_ID_PATTERN,
  SHA384_PATTERN,
  assertSecureUrl,
  isLoopbackHost,
} from '../src/index.ts'

const prod = { development: false }

test('loopback hosts are localhost, 127.0.0.0/8 and [::1]', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.9.8.7']) {
    expect(isLoopbackHost(host)).toBe(true)
  }
  expect(isLoopbackHost(new URL('http://[::1]:3000/').hostname)).toBe(true)
  for (const host of ['localhost.evil.example', '128.0.0.1', 'example.com']) {
    expect(isLoopbackHost(host)).toBe(false)
  }
})

test('rejects http on a non-loopback host outside development', () => {
  expect(() =>
    assertSecureUrl(
      new URL('http://user:secret@shop.example/path?q=1'),
      'remotes.shop.origin',
      prod
    )
  ).toThrow(/NF-002.*remotes\.shop\.origin.*http:\/\/shop\.example\b/)
  try {
    assertSecureUrl(new URL('http://user:secret@shop.example/path'), 'k', prod)
  } catch (e) {
    expect(String((e as Error).message)).not.toMatch(/secret|user|path/)
  }
})

test('accepts https, loopback http and development', () => {
  expect(() =>
    assertSecureUrl(new URL('https://shop.example/'), 'k', prod)
  ).not.toThrow()
  for (const url of [
    'http://localhost:3001/',
    'http://127.0.0.1:3001/',
    'http://[::1]:3001/',
  ]) {
    expect(() => assertSecureUrl(new URL(url), 'k', prod)).not.toThrow()
  }
  expect(() =>
    assertSecureUrl(new URL('http://shop.example/'), 'k', {
      development: true,
    })
  ).not.toThrow()
})

test('defaults to NODE_ENV (development and test allow http)', () => {
  const before = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'production'
    expect(() => assertSecureUrl(new URL('http://shop.example/'), 'k')).toThrow(
      /NF-002/
    )
    process.env.NODE_ENV = 'test'
    expect(() =>
      assertSecureUrl(new URL('http://shop.example/'), 'k')
    ).not.toThrow()
  } finally {
    process.env.NODE_ENV = before
  }
})

test('allowInsecureHttp accepts http and warns once per process', () => {
  const warn = rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
  try {
    const opts = { ...prod, allowInsecureHttp: true }
    assertSecureUrl(new URL('http://shop.example/'), 'a', opts)
    assertSecureUrl(new URL('http://cart.example/'), 'b', opts)
    expect(warn).toHaveBeenCalledWith(
      'NF-002',
      'allowInsecureHttp',
      expect.stringContaining('http://shop.example')
    )
    // One key: the logger prints it once per process.
    expect(new Set(warn.mock.calls.map((c) => c[1])).size).toBe(1)
  } finally {
    warn.mockRestore()
  }
})

test('BUILD_ID_PATTERN: leading alphanumeric, 1-128 chars', () => {
  for (const id of ['c1', 'a.b-c_d', 'x'.repeat(128)]) {
    expect(BUILD_ID_PATTERN.test(id)).toBe(true)
  }
  for (const id of ['_canary', '-x', '.', '..', 'x'.repeat(129), 'a/b', '']) {
    expect(BUILD_ID_PATTERN.test(id)).toBe(false)
  }
})

test('SHA384_PATTERN matches the SRI form', () => {
  expect(SHA384_PATTERN.test('sha384-AAAA+/==')).toBe(true)
  expect(SHA384_PATTERN.test('sha256-AAAA')).toBe(false)
})
