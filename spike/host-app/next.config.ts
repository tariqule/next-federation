import path from 'node:path';
import type { NextConfig } from 'next';

const CC = process.env.NF_CC === '1';
// Two island caching paths (design §6 table). 'use cache' only compiles with cacheComponents,
// so the path is chosen at build time via an alias.
const islandCache = CC
  ? './lib/island-cache.cc.ts'
  : './lib/island-cache.legacy.ts';
const root = path.join(import.meta.dirname, '../..');

const config: NextConfig = {
  cacheComponents: CC,
  basePath: process.env.NF_BASE ?? '',
  distDir: CC ? '.next-cc' : '.next',
  transpilePackages: ['@nf-spike/proto'],
  outputFileTracingRoot: root,
  env: { NF_BASE: process.env.NF_BASE ?? '' },
  turbopack: { root, resolveAlias: { '@nf/island-cache': islandCache } },
  webpack(cfg) {
    cfg.resolve.alias = {
      ...cfg.resolve.alias,
      '@nf/island-cache': path.join(import.meta.dirname, islandCache),
    };
    return cfg;
  },
};
export default config;
