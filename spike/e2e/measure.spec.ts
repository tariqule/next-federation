import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Gates f and h: island JS cost and how often island data appears in a host page.
// Run with NF_MEASURE=1 NF_REMOTE_MODE=prod; writes docs/spike/measurements.json.
test.skip(process.env.NF_MEASURE !== '1', 'needs NF_MEASURE=1');

const REMOTES = ['http://127.0.0.1:4100', 'http://127.0.0.1:4101'];
const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;
const kb = (n: number) => Math.round((n / 1024) * 10) / 10;
const report: Record<string, unknown> = {};

test('island JS cost in the browser (production remotes)', async ({ page }) => {
  const perRemote: Record<
    string,
    { files: number; raw: number; gzip: number }
  > = {};
  page.on('response', async (r) => {
    const origin = REMOTES.find((o) => r.url().startsWith(o));
    if (!origin || !r.url().endsWith('.js')) return;
    const body = await r.body().catch(() => Buffer.alloc(0));
    const entry = (perRemote[origin] ??= { files: 0, raw: 0, gzip: 0 });
    entry.files += 1;
    entry.raw += body.length;
    entry.gzip += gzipSync(body).length;
  });
  await page.goto('http://localhost:4200/islands');
  await expect(page.locator('[data-nf-state="live"]')).toHaveCount(2);
  await page.waitForTimeout(500);
  report.islandJs = Object.fromEntries(
    Object.entries(perRemote).map(([o, v]) => [
      o,
      { files: v.files, rawKB: kb(v.raw), gzipKB: kb(v.gzip) },
    ]),
  );
});

test('island data duplication in host pages', async ({ request }) => {
  const env = await (
    await request.get(
      `http://127.0.0.1:4100/_nf/island/ProductPanel?p=${Buffer.from(JSON.stringify({ sku: 'A1' })).toString('base64url')}`,
    )
  ).json();
  const marker = 'nf-product-panel'; // appears once in the island HTML
  const dup: Record<string, unknown> = {
    envelope: {
      htmlKB: kb(env.html.length),
      rscPayloadKB: kb(env.rscPayload.length),
    },
  };
  for (const [name, url] of [
    ['appRouter', 'http://localhost:3100/'],
    ['appRouterCacheComponents', 'http://localhost:3102/'],
    ['pagesRouter', 'http://localhost:3101/'],
  ] as const) {
    const html = await (await request.get(url)).text();
    dup[name] = {
      documentKB: kb(html.length),
      islandHtmlCopies: count(html, marker),
      // rough: the RSC payload's first client-reference row identifies it
      rscPayloadCopies: count(
        html.replaceAll('\\"', '"'),
        env.rscPayload.slice(0, 24),
      ),
    };
  }
  report.duplication = dup;
});

test.afterAll(() => {
  writeFileSync(
    new URL('../../docs/spike/measurements.json', import.meta.url),
    JSON.stringify(
      { measuredAt: new Date().toISOString(), ...report },
      null,
      2,
    ) + '\n',
  );
});
