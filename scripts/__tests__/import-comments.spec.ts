import { importCallComments } from '../lib/import-comments.mjs'

test('returns the comments between import( and the argument', () => {
  const source =
    'x; import(\n  /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url\n)'
  expect(importCallComments(source, 'url')).toBe(
    '/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ '
  )
})

test('skips an import() of another argument or without comments', () => {
  const source = 'import(other); import(url); import(/* a */ url)'
  expect(importCallComments(source, 'url')).toBe('/* a */ ')
  expect(importCallComments('import(url)', 'url')).toBe(null)
  expect(importCallComments('import(/* a */ urlx)', 'url')).toBe(null)
  expect(importCallComments('import(/* open', 'url')).toBe(null)
})

test.each([26, 50_000])(
  'is fast on `import(/*` + %i `*//*` that never reach the argument',
  (n) => {
    // The old regex doubled its time with every added `*//*`: about 0.5 s at 26.
    const crafted = `import(/*${'*//*'.repeat(n)}`
    const started = performance.now()
    expect(importCallComments(crafted, 'url')).toBe(null)
    expect(performance.now() - started).toBeLessThan(200)
  }
)
