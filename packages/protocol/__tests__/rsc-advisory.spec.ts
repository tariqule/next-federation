import {
  RSC_ADVISORY,
  checkFlightClientVersion,
  flightClientAdvisoryDetail,
} from '../src/index.ts'

test('names GHSA-xqc2-xf4c-x3h3', () => {
  expect(RSC_ADVISORY).toEqual({
    id: 'GHSA-xqc2-xf4c-x3h3',
    url: 'https://github.com/advisories/GHSA-xqc2-xf4c-x3h3',
  })
})

const series = (minor: number, below: number, patched: string) =>
  Array.from(
    { length: below },
    (_, patch) => [`19.${minor}.${patch}`, patched] as const
  )

// Every affected release, with the first patched release of its minor line.
test.each([
  ...series(0, 9, '19.0.9'),
  ...series(1, 10, '19.1.10'),
  ...series(2, 9, '19.2.9'),
  ['19.3.0', '19.3.1'],
])('%s is affected; %s is its patched release', (version, patched) => {
  expect(checkFlightClientVersion(version)).toEqual({
    status: 'affected',
    patched,
  })
})

test.each([
  // React keeps naming canaries after 19.3.0 `19.3.0-canary-*`, even those
  // published after the fix: they fail closed.
  ['19.3.0-canary-df6aa4ec-20261112', '19.3.1'],
  ['19.3.1-rc.0', '19.3.1'],
  ['19.2.9-beta.1', '19.2.9'],
])('the prerelease %s is affected (below %s)', (version, patched) => {
  expect(checkFlightClientVersion(version)).toEqual({
    status: 'affected',
    patched,
  })
})

test.each([
  '19.0.9',
  '19.0.10',
  '19.1.10',
  '19.1.11',
  '19.2.9',
  '19.2.12',
  '19.3.1',
  '19.3.2',
  '19.4.0',
  '18.3.1',
  '20.0.0',
])('%s is not affected', (version) => {
  expect(checkFlightClientVersion(version)).toEqual({ status: 'patched' })
})

test.each([
  '0.0.0-experimental-df6aa4ec-20261112',
  '0.0.0-df6aa4ec-20261112',
  'not-a-version',
  '',
])(
  '%s cannot be checked against the advisory (experimental or unknown)',
  (version) => {
    expect(checkFlightClientVersion(version)).toEqual({
      status: 'unverifiable',
    })
  }
)

test('the NF-041 detail names the advisory, the place and what to install', () => {
  expect(flightClientAdvisoryDetail('19.3.1')).toBeNull()
  const affected = flightClientAdvisoryDetail('19.1.4', '/app/node_modules')!
  expect(affected).toContain(
    'react-server-dom-webpack 19.1.4 (/app/node_modules)'
  )
  expect(affected).toContain(RSC_ADVISORY.id)
  expect(affected).toContain(RSC_ADVISORY.url)
  expect(affected).toContain('Install 19.1.10 or later')
  expect(affected).toContain(
    'npm install --save-exact react@19.1.10 react-dom@19.1.10 react-server-dom-webpack@19.1.10'
  )
  const experimental = flightClientAdvisoryDetail('0.0.0-experimental-abc')!
  expect(experimental).toMatch(/experimental builds cannot be checked/)
  expect(experimental).toContain(RSC_ADVISORY.id)
})
