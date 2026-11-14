import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.join(import.meta.dirname, '../..');
const base = process.env.NF_BASE ?? '';

const config: NextConfig = {
  basePath: base,
  // Two dev servers run from this folder (with and without basePath).
  distDir: base ? '.next-base' : '.next',
  i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
  transpilePackages: ['@nf-spike/proto'],
  outputFileTracingRoot: root,
  env: { NF_BASE: base },
  turbopack: { root },
};
export default config;
