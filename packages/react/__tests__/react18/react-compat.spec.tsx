import {
  ensureStylesheet,
  preloadModuleScript,
  preloadStyle,
  readThenable,
  supportsResources,
} from '../../src/react-compat.ts'
import type { Thenable } from '../../src/components/runtime.ts'

// The `dom-react18` project resolves `react` and `react-dom` to 18.3.1.

function thenable<T>(
  status: 'pending' | 'fulfilled' | 'rejected',
  extra: { value?: T; reason?: unknown } = {}
): Thenable<T> {
  const promise = new Promise<T>(() => {}) as Thenable<T>
  promise.status = status
  if ('value' in extra) promise.value = extra.value
  if ('reason' in extra) promise.reason = extra.reason
  return promise
}

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('react-compat on React 18', () => {
  it('has no resource APIs', () => {
    expect(supportsResources()).toBe(false)
  })

  it('ensureStylesheet appends one head link per href', () => {
    ensureStylesheet('/a.css')
    ensureStylesheet('/a.css')
    const links = document.head.querySelectorAll(
      'link[href="/a.css"][data-nf-css]'
    )
    expect(links.length).toBe(1)
    expect(links[0]?.getAttribute('rel')).toBe('stylesheet')
    expect(links[0]?.getAttribute('data-precedence')).toBe('next-federation')
  })

  it('ensureStylesheet appends after existing head stylesheets', () => {
    document.head.innerHTML = '<link rel="stylesheet" href="/app.css">'
    ensureStylesheet('/a.css')
    const hrefs = [...document.head.querySelectorAll('link')].map((l) =>
      l.getAttribute('href')
    )
    expect(hrefs).toEqual(['/app.css', '/a.css'])
  })

  it('an inline body link with the same href does not count', () => {
    document.body.innerHTML =
      '<link rel="stylesheet" href="/a.css" data-nf-css="">'
    ensureStylesheet('/a.css')
    expect(
      document.head.querySelectorAll('link[href="/a.css"][data-nf-css]').length
    ).toBe(1)
  })

  it('readThenable throws the pending thenable, returns the fulfilled value, throws the rejection reason', () => {
    const pending = thenable<string>('pending')
    let thrown: unknown
    try {
      readThenable(pending)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(pending)
    expect(readThenable(thenable('fulfilled', { value: 'ok' }))).toBe('ok')
    const reason = new Error('boom')
    expect(() => readThenable(thenable('rejected', { reason }))).toThrow(reason)
  })

  it('preloadStyle and preloadModuleScript add nothing on React 18', () => {
    preloadStyle('/a.css')
    preloadModuleScript('/m.js')
    expect(document.head.children.length).toBe(0)
    expect(document.body.children.length).toBe(0)
  })
})
