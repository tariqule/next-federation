import { applyIdPrefix, parseEnvelope } from '../src/index.ts'

const env = {
  html: '<i id="nfid-1a2b3c4d-R1"></i>',
  rscPayload: '"nfid-1a2b3c4d-R1"',
  idPlaceholder: 'nfid-1a2b3c4d-',
}

test('two mounts of one envelope get distinct prefixes and no placeholder remains', () => {
  const a = applyIdPrefix(env, '«r1»')
  const b = applyIdPrefix(env, '«r2»')
  expect(a.identifierPrefix).toBe('nfid-1a2b3c4d-r1-')
  expect(a.html).toBe('<i id="nfid-1a2b3c4d-r1-R1"></i>')
  expect(a.rscPayload).toBe('"nfid-1a2b3c4d-r1-R1"')
  expect(b.identifierPrefix).not.toBe(a.identifierPrefix)
  expect(b.html).not.toContain('nfid-1a2b3c4d-R1')
})

test('an empty placeholder cannot reach applyIdPrefix through parseEnvelope', () =>
  expect(() =>
    parseEnvelope({
      protocolVersion: 1,
      remote: 'a',
      buildId: 'v1',
      mode: 'production',
      html: '<p>x</p>',
      rscPayload: '0:x',
      css: [],
      bootstrap: 'https://r.example/b.js',
      reactVersion: '19.3.1',
      idPlaceholder: '',
    })
  ).toThrow(/NF-004/))

test('replaces every occurrence', () => {
  const r = applyIdPrefix(
    {
      html: 'nfid-x-A nfid-x-B',
      rscPayload: 'nfid-x-C',
      idPlaceholder: 'nfid-x-',
    },
    'm'
  )
  expect(r.html).toBe('nfid-x-m-A nfid-x-m-B')
  expect(r.rscPayload).toBe('nfid-x-m-C')
})
