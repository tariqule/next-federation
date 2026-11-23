// `@next-federation/router/next-host` builds the guarded modules when a
// Next.js entry is evaluated, also on the server. Next's `next/router`
// module object is its Router singleton, whose fields are getters that throw
// where there is no router (the server): building the guarded module never
// reads an export it does not replace.
import { describe, expect, it } from '@rstest/core'
import { guardNextLink, guardNextRouter } from '../src/next-host.tsx'

/** Like Next's `next/router` exports on the server. */
function serverNextRouter() {
  const noRouter = () => {
    throw new Error('No router instance found.')
  }
  const singleton = { push: noRouter, replace: noRouter }
  const module: Record<string, unknown> = {}
  for (const field of ['router', 'pathname', 'query', 'asPath']) {
    Object.defineProperty(singleton, field, { enumerable: true, get: noRouter })
    Object.defineProperty(module, field, { enumerable: true, get: noRouter })
  }
  module.default = singleton
  module.useRouter = () => null
  module.withRouter = () => null
  module.Router = class {}
  return module
}

describe('next-host modules on the server', () => {
  it('guardNextRouter reads none of the getters it keeps; they still read through', () => {
    const module = serverNextRouter()
    let guarded: Record<string, unknown> | undefined
    expect(() => {
      guarded = guardNextRouter(module)
    }).not.toThrow()
    expect(Object.keys(guarded!).sort()).toEqual(Object.keys(module).sort())
    expect(guarded!.Router).toBe(module.Router)
    expect(() => guarded!.pathname).toThrow(/No router instance found/)
    expect(() => (guarded!.default as { pathname: string }).pathname).toThrow(
      /No router instance found/
    )
  })

  it('guardNextLink keeps a getter export as a getter', () => {
    let reads = 0
    const module = {
      default: () => null,
      get useLinkStatus() {
        reads += 1
        return () => ({ pending: false })
      },
    }
    const guarded = guardNextLink(module)
    expect(reads).toBe(0)
    expect(typeof guarded.useLinkStatus).toBe('function')
    expect(reads).toBe(1)
    expect((guarded as { __esModule?: unknown }).__esModule).toBe(true)
  })
})
