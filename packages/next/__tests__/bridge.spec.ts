import { stripBasePath, toPagesRouterHref } from '../src/bridge.ts'

test('strips the basePath so router.push does not double it', () => {
  expect(stripBasePath('/base/nav/two', '/base')).toBe('/nav/two')
  expect(stripBasePath('/base', '/base')).toBe('/')
})
test('leaves hrefs without the basePath alone', () => {
  expect(stripBasePath('/nav/two', '')).toBe('/nav/two')
  expect(stripBasePath('/baseball', '/base')).toBe('/baseball')
})
test('keeps query and hash', () => {
  expect(stripBasePath('/base/nav/two?x=1#h', '/base')).toBe('/nav/two?x=1#h')
})

describe('toPagesRouterHref', () => {
  const locales = ['en', 'fr']

  test('strips basePath and the locale prefix, returning the locale separately', () => {
    expect(
      toPagesRouterHref('/base/fr/nav/two', '/base', locales, 'en')
    ).toEqual({
      href: '/nav/two',
      locale: 'fr',
    })
  })

  test('a locale root maps to "/"', () => {
    expect(toPagesRouterHref('/fr', '', locales, 'en')).toEqual({
      href: '/',
      locale: 'fr',
    })
  })

  test('with i18n, a path without a locale prefix means the default locale', () => {
    // On a /fr page, an island href with no prefix is the default-locale
    // page (as its href and a hard load are), not the current locale.
    expect(toPagesRouterHref('/base/nav/two', '/base', locales, 'en')).toEqual({
      href: '/nav/two',
      locale: 'en',
    })
    expect(toPagesRouterHref('/', '', locales, 'en')).toEqual({
      href: '/',
      locale: 'en',
    })
  })

  test('without i18n the locale stays undefined', () => {
    expect(toPagesRouterHref('/nav/two', '', [], undefined)).toEqual({
      href: '/nav/two',
      locale: undefined,
    })
  })

  test('does not treat a path segment that merely starts with a locale as one', () => {
    expect(toPagesRouterHref('/french-fries', '', locales, 'en')).toEqual({
      href: '/french-fries',
      locale: 'en',
    })
  })
})
