import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isNFError } from '@next-federation/sdk'
import {
  callerDir,
  installedNext,
  nextProjectDir,
  readNext,
} from '../src/installed-next.ts'

// The real installs (pnpm links each project's own version): this package
// and the Next 16 fixtures have next 16, the Next 15 fixtures next 15. The
// workspace root has none.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const PACKAGE = join(ROOT, 'packages/next')
const NEXT15 = join(ROOT, 'test/fixtures/host-app-next15')
const NEXT16 = join(ROOT, 'test/fixtures/host-app')
const EMPTY = mkdtempSync(join(tmpdir(), 'nf-no-next-'))

function caught(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

describe('readNext against real installs (cacheLife feature detection)', () => {
  test('Next 15 (next/cache has unstable_cacheLife only): no stable cacheLife', () => {
    const next = readNext(NEXT15)
    expect(next).toMatchObject({ version: '15.5.28', cacheComponents: false })
    expect(next!.path).toContain('next@15.5.28')
  })

  test('the workspace Next 16: stable cacheLife', () => {
    const next = readNext(PACKAGE)
    expect(next).toMatchObject({ version: '16.4.6', cacheComponents: true })
    expect(next!.path).toContain('next@16.4.6')
  })

  test('no node_modules/next from the folder upwards: null, even when NODE_PATH would resolve one', () => {
    expect(readNext(EMPTY)).toBeNull()
    expect(readNext(ROOT)).toBeNull()
  })
})

describe('installedNext: the project folder and the working directory', () => {
  test('`next build apps/web` from a root with another major is NF-002 naming both', () => {
    // NEXT16 stands in for a monorepo root with next 16 installed.
    const error = caught(() => installedNext(NEXT15, NEXT16))
    expect(isNFError(error)).toBe(true)
    expect((error as { code: string }).code).toBe('NF-002')
    const message = (error as Error).message
    expect(message).toContain('15.5.28')
    expect(message).toContain('16.4.6')
    expect(message).toContain(NEXT15)
    expect(message).toContain(NEXT16)
  })

  test('the same major in both: the project folder wins', () => {
    expect(installedNext(NEXT16, PACKAGE).version).toBe('16.4.6')
  })

  test('a cwd without its own next (a bare monorepo root) is not a conflict', () => {
    expect(installedNext(NEXT15, ROOT).version).toBe('15.5.28')
  })

  test('the project folder alone (no next at cwd)', () => {
    expect(installedNext(NEXT15, EMPTY)).toMatchObject({
      version: '15.5.28',
      cacheComponents: false,
    })
  })

  test('the working directory alone (project folder unknown)', () => {
    expect(installedNext(null, NEXT15).version).toBe('15.5.28')
  })
})

describe('callerDir: the folder of the file that called withNextFederation', () => {
  const at = (line: string) =>
    `Error\n    ${line}\n    at more (/elsewhere/x.js:1:1)`

  test('CommonJS and the compiled next.config.ts', () => {
    expect(
      callerDir(at('at Object.<anonymous> (/apps/web/next.config.js:3:16)'))
    ).toBe('/apps/web')
    expect(callerDir(at('at /apps/web/next.config.compiled.js:5:20'))).toBe(
      '/apps/web'
    )
  })

  test('an ES module (file URL)', () => {
    const url = pathToFileURL('/apps/web/next.config.mjs').href
    expect(callerDir(at(`at ${url}:3:16`))).toBe('/apps/web')
    expect(callerDir(at(`at async default (${url}:3:16)`))).toBe('/apps/web')
  })

  test('nothing usable: null', () => {
    expect(callerDir(undefined)).toBeNull()
    expect(callerDir('Error')).toBeNull()
    expect(callerDir(at('at node:internal/modules/run_main:1:1'))).toBeNull()
    expect(callerDir(at('at <anonymous>'))).toBeNull()
  })
})

describe('callerDir: paths with parentheses and spaces', () => {
  const at = (line: string) =>
    `Error\n    ${line}\n    at more (/elsewhere/x.js:1:1)`

  test('a folder named like `proj (copy)`', () => {
    expect(
      callerDir(
        at('at Object.<anonymous> (/work/proj (copy)/next.config.js:3:16)')
      )
    ).toBe('/work/proj (copy)')
    expect(
      callerDir(at('at /work/proj (copy)/next.config.compiled.js:5:2'))
    ).toBe('/work/proj (copy)')
    const url = pathToFileURL('/work/proj (copy)/next.config.mjs').href
    expect(callerDir(at(`at async default (${url}:3:16)`))).toBe(
      '/work/proj (copy)'
    )
  })

  test('a Windows path', () => {
    const dir = callerDir(
      at('at Object.<anonymous> (C:\\work\\proj (copy)\\next.config.js:3:16)')
    )
    expect(dir === null || dir.endsWith('proj (copy)')).toBe(true)
  })
})

describe('nextProjectDir: the caller folder only when it holds a next.config', () => {
  const stackFrom = (file: string) =>
    `Error\n    at Object.<anonymous> (${file}:3:16)\n    at more (/x.js:1:1)`

  test('a folder with next.config.ts (Next 15 runs its compiled copy there)', () => {
    expect(
      nextProjectDir(stackFrom(join(NEXT15, 'next.config.compiled.js')))
    ).toBe(NEXT15)
    expect(nextProjectDir(stackFrom(join(NEXT16, 'next.config.ts')))).toBe(
      NEXT16
    )
  })

  test('a helper file elsewhere (no next.config in its folder): null, so cwd decides', () => {
    expect(
      nextProjectDir(stackFrom(join(PACKAGE, 'src', 'helper.js')))
    ).toBeNull()
    expect(nextProjectDir(stackFrom(join(EMPTY, 'with-next.js')))).toBeNull()
    expect(nextProjectDir(undefined)).toBeNull()
  })
})
