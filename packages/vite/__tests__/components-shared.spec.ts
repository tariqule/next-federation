import { resolveComponentsOptions } from '../src/components/options.ts'
import { collectSharedUsage, mfSharedConfig } from '../src/components/shared.ts'

const ctx = {
  command: 'build' as const,
  env: {},
  now: 1_700_000_000_000,
}
const resolved = resolveComponentsOptions(
  {
    name: 'components',
    base: 'https://remote.example',
    exposes: {
      './Counter': './src/Counter.tsx',
      './NavLink': './src/NavLink.tsx',
    },
    shared: {
      'components-context': {},
      'date-lib': { requiredVersion: '^2.0.0', fallback: true },
      'next/link': {},
    },
  },
  ctx
)

test('resolves fallback and next/* entries', () => {
  expect(resolved.shared['date-lib']).toEqual({
    requiredVersion: '^2.0.0',
    fallback: true,
  })
  expect(resolved.shared['next/link']).toEqual({
    requiredVersion: false,
    fallback: false,
  })
  for (const name of ['next/navigation', 'next/router']) {
    expect(
      resolveComponentsOptions(
        {
          name: 'components',
          base: 'https://remote.example',
          exposes: { './A': './a.tsx' },
          shared: [name],
        },
        ctx
      ).shared[name]
    ).toEqual({ requiredVersion: false, fallback: false })
  }
})

test('Module Federation config: host-only singletons, or a bundled non-singleton fallback', () => {
  const mf = mfSharedConfig(resolved)
  expect(mf.react).toEqual({
    singleton: true,
    requiredVersion: '^19.0.0',
    import: false,
  })
  expect(mf['components-context']).toEqual({
    singleton: true,
    requiredVersion: false,
    import: false,
  })
  // Bundled (no `import: false`); not a singleton, so Module Federation picks
  // the host's copy only when it satisfies the range, else this build's own.
  expect(mf['date-lib']).toEqual({
    singleton: false,
    requiredVersion: '^2.0.0',
  })
})

test('collectSharedUsage walks each expose graph (static and dynamic imports)', () => {
  const graph: Record<
    string,
    { importedIds: string[]; dynamicallyImportedIds: string[] }
  > = {
    '/r/src/Counter.tsx': {
      importedIds: ['/r/src/util.ts', '\0virtual:share'],
      dynamicallyImportedIds: ['/r/src/lazy.tsx'],
    },
    '/r/src/util.ts': {
      importedIds: ['/r/src/Counter.tsx'],
      dynamicallyImportedIds: [],
    },
    '/r/src/lazy.tsx': { importedIds: [], dynamicallyImportedIds: [] },
    '/r/src/NavLink.tsx': { importedIds: [], dynamicallyImportedIds: [] },
  }
  const imports = new Map([
    ['/r/src/util.ts', new Set(['components-context'])],
    ['/r/src/lazy.tsx', new Set(['date-lib'])],
    ['/r/src/NavLink.tsx', new Set(['next/link'])],
  ])
  const usage = collectSharedUsage(
    { './Counter': '/r/src/Counter.tsx', './NavLink': '/r/src/NavLink.tsx' },
    (id) => graph[id] ?? null,
    imports
  )
  expect(usage).toEqual(
    new Map([
      ['./Counter', new Set(['components-context', 'date-lib'])],
      ['./NavLink', new Set(['next/link'])],
    ])
  )
  // An expose missing from the graph: usage unknown (never under-report).
  expect(
    collectSharedUsage(
      { './X': '/r/src/X.tsx' },
      (id) => graph[id] ?? null,
      imports
    )
  ).toBeNull()
})
