import { expect, test } from '@rstest/core';
import { stripBasePath } from '../src/bridge';

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
