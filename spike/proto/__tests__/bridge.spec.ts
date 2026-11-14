import { describe, expect, test } from '@rstest/core';
import { stripBasePath, toPagesRouterHref } from '../src/bridge';

test('strips the basePath so router.push does not double it', () => {
  expect(stripBasePath('/base/nav/two', '/base')).toBe('/nav/two');
  expect(stripBasePath('/base', '/base')).toBe('/');
});
test('leaves hrefs without the basePath alone', () => {
  expect(stripBasePath('/nav/two', '')).toBe('/nav/two');
  expect(stripBasePath('/baseball', '/base')).toBe('/baseball');
});
test('keeps query and hash', () => {
  expect(stripBasePath('/base/nav/two?x=1#h', '/base')).toBe('/nav/two?x=1#h');
});

describe('toPagesRouterHref', () => {
  const locales = ['en', 'fr'];

  test('strips basePath and the locale prefix, returning the locale separately', () => {
    expect(toPagesRouterHref('/base/fr/nav/two', '/base', locales)).toEqual({
      href: '/nav/two',
      locale: 'fr',
    });
  });

  test('a locale root maps to "/"', () => {
    expect(toPagesRouterHref('/fr', '', locales)).toEqual({
      href: '/',
      locale: 'fr',
    });
  });

  test('a path without a locale keeps the current locale (undefined)', () => {
    expect(toPagesRouterHref('/nav/two', '', locales)).toEqual({
      href: '/nav/two',
      locale: undefined,
    });
  });

  test('does not treat a path segment that merely starts with a locale as one', () => {
    expect(toPagesRouterHref('/french-fries', '', locales)).toEqual({
      href: '/french-fries',
      locale: undefined,
    });
  });
});
