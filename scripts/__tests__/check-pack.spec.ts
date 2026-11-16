import { checkPack, collectExportTargets } from '../lib/pack-problems.mjs'

const ok = [
  'package.json',
  'README.md',
  'LICENSE',
  'dist/index.js',
  'dist/index.d.ts',
]
const exportsMap = {
  '.': { types: './dist/index.d.ts', default: './dist/index.js' },
  './package.json': './package.json',
}

test('collects string, nested and subpath targets, including types', () => {
  expect(collectExportTargets(exportsMap).sort()).toEqual([
    './dist/index.d.ts',
    './dist/index.js',
    './package.json',
  ])
})

test('a clean tarball has no problems', () => {
  expect(checkPack('@x/a', ok, exportsMap)).toEqual([])
})

test('flags files outside the allowed set', () => {
  expect(
    checkPack('@x/a', [...ok, 'src/index.ts', '.env'], exportsMap)
  ).toEqual([
    '@x/a: unexpected file in tarball: src/index.ts',
    '@x/a: unexpected file in tarball: .env',
  ])
})

test('flags a missing exports target, including a types target', () => {
  expect(
    checkPack(
      '@x/a',
      ok.filter((f) => f !== 'dist/index.d.ts'),
      exportsMap
    )
  ).toEqual(['@x/a: exports target ./dist/index.d.ts is not in the tarball'])
})

test('flags missing README or LICENSE', () => {
  expect(
    checkPack(
      '@x/a',
      ok.filter((f) => f !== 'LICENSE'),
      exportsMap
    )
  ).toEqual(['@x/a: required file LICENSE is not in the tarball'])
})

test('fails when exports collect to nothing', () => {
  expect(checkPack('@x/a', ok, undefined)).toEqual([
    '@x/a: exports map has no file targets',
  ])
  expect(checkPack('@x/a', ok, { '.': {} })).toEqual([
    '@x/a: exports map has no file targets',
  ])
})
