import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from '@rstest/core'
import * as router from '../src/index.ts'

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')
) as { version: string }

const NAMES = [
  'Link',
  'ROUTER_SHARE_NAME',
  'ROUTER_VERSION',
  'createRouterModule',
  'provideRouter',
  'useNavigate',
  'usePathname',
  'useSearchParams',
]

describe('router surface', () => {
  it('ROUTER_VERSION equals package.json version', () => {
    expect(router.ROUTER_VERSION).toBe(pkg.version)
  })
  it('runtime export names are exactly the documented set', () => {
    expect(Object.keys(router).sort()).toEqual(NAMES)
  })
  it('createRouterModule(impl) has exactly the same keys', () => {
    const mod = router.createRouterModule({
      Link: router.Link,
      useNavigate: router.useNavigate,
      usePathname: router.usePathname,
      useSearchParams: router.useSearchParams,
    })
    expect(Object.keys(mod).sort()).toEqual(NAMES)
  })
})
