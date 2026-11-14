import { describe, expect, test } from '@rstest/core';
import {
  GET_PROPS_LIMIT,
  ProtocolError,
  embedPayload,
  islandRequest,
  parseEnvelope,
  readIslandRequest,
  sanitizeIslandHtml,
} from '../src/protocol';

const origin = 'http://127.0.0.1:4100';

const toRequest = ({ url, init }: { url: string; init: RequestInit }) =>
  new Request(url, init);

const valid = {
  protocolVersion: 1,
  buildId: 'v1',
  html: '<p>x</p>',
  rscPayload: '0:"x"',
  css: [],
  bootstrap: 'http://127.0.0.1:4100/assets/bootstrap.js',
  reactVersion: '19.3.1',
  identifierPrefix: 'nf-a-P-1-',
};

describe('islandRequest / readIslandRequest', () => {
  test('small props with unicode, quotes and & use GET and round-trip exactly', async () => {
    const props = { sku: 'é"&<>' };
    const req = islandRequest(origin, 'ProductPanel', props);
    expect(req.init.method ?? 'GET').toBe('GET');
    expect(req.url.startsWith(`${origin}/_nf/island/ProductPanel?p=`)).toBe(
      true,
    );
    expect(await readIslandRequest(toRequest(req))).toEqual({
      island: 'ProductPanel',
      props,
    });
  });

  test('props whose encoding exceeds GET_PROPS_LIMIT use POST and round-trip exactly', async () => {
    const props = { text: 'x'.repeat(3000) };
    const req = islandRequest(origin, 'Banner', props);
    expect(req.init.method).toBe('POST');
    expect(req.url).toBe(`${origin}/_nf/island/Banner`);
    expect(await readIslandRequest(toRequest(req))).toEqual({
      island: 'Banner',
      props,
    });
  });

  test('the limit is 2048 encoded bytes', () => {
    expect(GET_PROPS_LIMIT).toBe(2048);
  });

  test('a token is sent as a bearer Authorization header', () => {
    const req = islandRequest(origin, 'MyOrders', {}, { token: 'abc' });
    expect(new Headers(req.init.headers).get('authorization')).toBe(
      'Bearer abc',
    );
  });
});

describe('parseEnvelope', () => {
  test('accepts a valid envelope', () => {
    expect(parseEnvelope(valid)).toEqual(valid);
  });

  test('rejects an unknown major protocolVersion', () => {
    expect(() => parseEnvelope({ ...valid, protocolVersion: 2 })).toThrow(
      ProtocolError,
    );
  });

  test('rejects a missing field', () => {
    const { html: _html, ...rest } = valid;
    expect(() => parseEnvelope(rest)).toThrow(ProtocolError);
  });
});

describe('embedPayload', () => {
  test('cannot break out of an inline script and round-trips', () => {
    const raw = '</script><!--  &';
    const out = embedPayload(raw);
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<!--');
    expect(out).not.toContain(' ');
    expect(JSON.parse(out)).toBe(raw);
  });
});

describe('sanitizeIslandHtml', () => {
  test('removes modulepreload links and inline scripts, keeps content', () => {
    const html =
      '<link rel="modulepreload" href="http://x/a.js" crossorigin=""/><link rel="modulepreload" href="http://x/b.js"/>' +
      '<section><h2>Product</h2><form action="javascript:throw 1"></form></section>' +
      '<script>addEventListener("submit",function(a){})</script>';
    expect(sanitizeIslandHtml(html)).toBe(
      '<section><h2>Product</h2><form action="javascript:throw 1"></form></section>',
    );
  });

  test('leaves escaped script text inside content untouched', () => {
    const html =
      '<strong>&lt;/script&gt;&lt;script&gt;window.pwned=1&lt;/script&gt;</strong>';
    expect(sanitizeIslandHtml(html)).toBe(html);
  });
});
