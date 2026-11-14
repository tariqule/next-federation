import { describe, expect, test } from '@rstest/core';
import { corsHeaders } from '../src/remote-handler';

const req = (origin?: string) =>
  new Request('http://127.0.0.1:4100/_nf/action', {
    headers: origin ? { origin } : {},
  });

describe('corsHeaders', () => {
  test('an allowed origin may send the headers island actions use', () => {
    const h = corsHeaders(req('http://localhost:4200'), [
      'http://localhost:4200',
    ]);
    expect(h['access-control-allow-origin']).toBe('http://localhost:4200');
    const allowed =
      h['access-control-allow-headers']!.toLowerCase().split(/,\s*/);
    expect(allowed).toEqual(
      expect.arrayContaining(['authorization', 'content-type', 'x-nf-action']),
    );
  });

  test('other origins get no CORS grant, only Vary', () => {
    expect(
      corsHeaders(req('http://evil.test'), ['http://localhost:4200']),
    ).toEqual({
      vary: 'Origin',
    });
  });
});
