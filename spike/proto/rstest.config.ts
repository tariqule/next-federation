import { defineConfig } from '@rstest/core';
import path from 'path';

export default defineConfig({
  // Node environment: identity tests start an HTTP server and use Node crypto.
  testEnvironment: 'node',
  include: [path.resolve(__dirname, '__tests__/*.spec.ts')],
  testTimeout: 10000,
});
