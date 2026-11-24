// Release tags for the publish workflow (scripts/release-tags.mjs): one
// `<name>@<version>` tag per published package, named from package.json (not
// from the registry, which can still show the previous version while npm holds
// a new one as staged).
import { planReleaseTags } from '../lib/release-tags.mjs'

const pkg = (name: string, version: string, extra = {}) => ({
  name,
  version,
  ...extra,
})

test('one tag per package, named from package.json', () => {
  const plan = planReleaseTags(
    [
      pkg('@next-federation/core', '0.2.1'),
      pkg('@next-federation/vite', '0.2.1'),
    ],
    new Set()
  )
  expect(plan).toEqual({
    create: ['@next-federation/core@0.2.1', '@next-federation/vite@0.2.1'],
    existing: [],
  })
})

test('tags that already exist on the remote are left alone (re-run)', () => {
  const plan = planReleaseTags(
    [
      pkg('@next-federation/core', '0.2.1'),
      pkg('@next-federation/vite', '0.2.1'),
    ],
    new Set(['@next-federation/core@0.2.1', '@next-federation/core@0.2.0'])
  )
  expect(plan).toEqual({
    create: ['@next-federation/vite@0.2.1'],
    existing: ['@next-federation/core@0.2.1'],
  })
})

test('private packages and packages without a name or version get no tag', () => {
  const plan = planReleaseTags(
    [
      pkg('@next-federation/core', '0.2.1'),
      pkg('host-app', '0.0.0', { private: true }),
      { version: '1.0.0' },
      { name: 'no-version' },
    ],
    new Set()
  )
  expect(plan.create).toEqual(['@next-federation/core@0.2.1'])
})

test('the plan is sorted, so the log and the push order are stable', () => {
  const plan = planReleaseTags(
    [
      pkg('@next-federation/vite', '0.2.1'),
      pkg('@next-federation/core', '0.2.1'),
    ],
    new Set()
  )
  expect(plan.create).toEqual([
    '@next-federation/core@0.2.1',
    '@next-federation/vite@0.2.1',
  ])
})
