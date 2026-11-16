import { isNFError } from '@next-federation/sdk'
import { planRetention } from '../src/node/retention.ts'

const NOW = Date.UTC(2026, 10, 15)
const b = (id: string, hoursAgo: number) => ({
  buildId: id,
  builtAt: NOW - hoursAgo * 3_600_000,
})

test('keeps the newest maxBuilds', () =>
  expect(
    planRetention([b('v1', 90), b('v2', 60), b('v3', 40), b('v4', 30)], NOW, {
      maxBuilds: 2,
      minAgeMs: 0,
    })
  ).toEqual({ current: 'v4', live: ['v4', 'v3'], retired: ['v2', 'v1'] }))

test('never retires a build younger than minAgeMs', () => {
  const builds = [1, 2, 3, 4, 5].map((n) => b(`v${n}`, n))
  const plan = planRetention(builds, NOW, {
    maxBuilds: 2,
    minAgeMs: 86_400_000,
  })
  expect(plan.live).toEqual(['v1', 'v2', 'v3', 'v4', 'v5'])
  expect(plan.retired).toEqual([])
})

test('an explicit current is always live even if oldest', () =>
  expect(
    planRetention(
      [b('v1', 90), b('v2', 60), b('v3', 40)],
      NOW,
      { maxBuilds: 1, minAgeMs: 0 },
      'v1'
    )
  ).toEqual({ current: 'v1', live: ['v3', 'v1'], retired: ['v2'] }))

test('no builds throws NF-002', () => {
  try {
    planRetention([], NOW, { maxBuilds: 3, minAgeMs: 0 })
    expect.unreachable()
  } catch (e) {
    expect(isNFError(e, 'NF-002')).toBe(true)
  }
})

test('an unknown explicit current throws NF-002', () => {
  expect(() =>
    planRetention([b('v1', 1)], NOW, { maxBuilds: 3, minAgeMs: 0 }, 'zz')
  ).toThrow(/NF-002/)
})
